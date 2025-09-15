import * as core from '@actions/core'
import * as github from '@actions/github'
import * as httpClient from '@actions/http-client'
import {Context} from '@actions/github/lib/context'
import {ApiClient, Credential, CredentialFetchingError} from './api-client'
import {getJobParameters} from './inputs'
import {ImageService, MetricReporter} from './image-service'
import {updaterImageName, PROXY_IMAGE_NAME} from './docker-tags'
import {Updater} from './updater'

export enum DependabotErrorType {
  Unknown = 'actions_workflow_unknown',
  Image = 'actions_workflow_image',
  UpdateRun = 'actions_workflow_updater'
}

let jobId: number

export async function run(context: Context): Promise<void> {
  try {
    botSay('starting update')

    // Retrieve JobParameters from the Actions environment
    const params = getJobParameters(context)

    // The parameters will be null if the Action environment
    // is not a valid Dependabot-triggered dynamic event.
    if (params === null) {
      botSay('finished: nothing to do')
      return // TODO: This should be setNeutral in future
    }

    // Use environment variables if set and not empty, otherwise use parameters.
    // The param values of job token and credentials token are kept to support backwards compatibility.
    const jobToken = process.env.GITHUB_DEPENDABOT_JOB_TOKEN || params.jobToken
    const credentialsToken =
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN || params.credentialsToken

    // Validate jobToken and credentialsToken
    if (!jobToken) {
      const errorMessage = 'Github Dependabot job token is not set'
      botSay(`finished: ${errorMessage}`)
      core.setFailed(errorMessage)
      return
    }
    if (!credentialsToken) {
      const errorMessage = 'Github Dependabot credentials token is not set'
      botSay(`finished: ${errorMessage}`)
      core.setFailed(errorMessage)
      return
    }

    jobId = params.jobId
    core.setSecret(jobToken)
    core.setSecret(credentialsToken)

    const client = new httpClient.HttpClient('github/dependabot-action')
    const apiClient = new ApiClient(client, params, jobToken, credentialsToken)

    core.info('Fetching job details')

    // If we fail to succeed in fetching the job details, we cannot be sure the job has entered a 'processing' state,
    // so we do not try attempt to report back an exception if this fails and instead rely on the workflow run
    // webhook as it anticipates scenarios where jobs have failed while 'enqueued'.
    const details = await apiClient.getJobDetails()

    // The dynamic workflow can specify which updater image to use. If it doesn't, fall back to the pinned version.
    const updaterImage =
      params.updaterImage || updaterImageName(details['package-manager'])

    // The sendMetrics function is used to send metrics to the API client.
    // It uses the package manager as a tag to identify the metric.
    const sendMetricsWithPackageManager: MetricReporter = async (
      name,
      metricType,
      value,
      additionalTags = {}
    ) => {
      try {
        await apiClient.sendMetrics(name, metricType, value, {
          package_manager: details['package-manager'],
          ...additionalTags
        })
      } catch (error) {
        core.warning(
          `Metric sending failed for ${name}: ${(error as Error).message}`
        )
      }
    }

    try {
      const credentials = (await apiClient.getCredentials()) || []
      const registryCredentials = credentialsFromEnv()

      credentials.push(...registryCredentials)

      const updater = new Updater(
        updaterImage,
        PROXY_IMAGE_NAME,
        apiClient,
        details,
        credentials
      )

      core.startGroup('Pulling updater images')
      try {
        // Using sendMetricsWithPackageManager wrapper to inject package manager tag ti
        // avoid passing additional parameters to ImageService.pull method
        await ImageService.pull(updaterImage, sendMetricsWithPackageManager)
        await ImageService.pull(PROXY_IMAGE_NAME, sendMetricsWithPackageManager)
      } catch (error: unknown) {
        if (error instanceof Error) {
          await failJob(
            apiClient,
            'Error fetching updater images',
            error,
            DependabotErrorType.Image
          )
          return
        }
      }
      core.endGroup()

      try {
        core.info('Starting update process')

        await updater.runUpdater(details.command)
      } catch (error: unknown) {
        if (error instanceof Error) {
          await failJob(
            apiClient,
            'Dependabot encountered an error performing the update',
            error,
            DependabotErrorType.UpdateRun
          )
          return
        }
      }
      botSay('finished')
    } catch (error: unknown) {
      if (error instanceof CredentialFetchingError) {
        await failJob(
          apiClient,
          'Dependabot was unable to retrieve job credentials',
          error,
          DependabotErrorType.UpdateRun
        )
      } else if (error instanceof Error) {
        await failJob(
          apiClient,
          'Dependabot was unable to start the update',
          error
        )
      }

      return
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      // If we've reached this point, we do not have a viable
      // API client to report back to Dependabot API.
      //
      // We output the raw error in the Action logs and defer
      // to workflow_run monitoring to detect the job failure.
      setFailed('Dependabot encountered an unexpected problem', error)
      botSay('finished: unexpected error')
    }
  }
}

async function failJob(
  apiClient: ApiClient,
  message: string,
  error: Error,
  errorType = DependabotErrorType.Unknown
): Promise<void> {
  await apiClient.reportJobError({
    'error-type': errorType,
    'error-details': {
      'action-error': error.message
    }
  })
  await apiClient.markJobAsProcessed()
  setFailed(message, error)
  botSay('finished: error reported to Dependabot')
}

function botSay(message: string): void {
  core.info(`🤖 ~ ${message} ~`)
}

function setFailed(message: string, error: Error | null): void {
  if (jobId) {
    message = [message, error, dependabotJobHelp()].filter(Boolean).join('\n\n')
  }

  core.setFailed(message)
}

function dependabotJobHelp(): string | null {
  if (jobId) {
    return `For more information see: ${dependabotJobUrl(
      jobId
    )} (write access to the repository is required to view the log)`
  } else {
    return null
  }
}

function dependabotJobUrl(id: number): string {
  const url_parts = [
    process.env.GITHUB_SERVER_URL,
    process.env.GITHUB_REPOSITORY,
    'network/updates',
    id
  ]

  return url_parts.filter(Boolean).join('/')
}

export function credentialsFromEnv(): Credential[] {
  const registriesProxyStr = process.env.GITHUB_REGISTRIES_PROXY
  let credentialsStr: string
  if (registriesProxyStr !== undefined) {
    credentialsStr = Buffer.from(registriesProxyStr, 'base64').toString()
  } else {
    return []
  }

  let parsed: Credential[]

  try {
    parsed = JSON.parse(credentialsStr) as Credential[]
  } catch {
    // Don't log the error as it may contain sensitive information
    parsed = []
    botSay('Failed to parse GITHUB_REGISTRIES_PROXY environment variable')
  }

  const nonSecrets = ['type', 'url', 'username', 'host', 'replaces-base']
  for (const e of parsed) {
    // Mask credentials to reduce chance of accidental leakage in logs.
    for (const key of Object.keys(e)) {
      if (!nonSecrets.includes(key)) {
        core.setSecret((e as Record<string, unknown>)[key] as string)
      }
    }

    // TODO: Filter down to only credentials relevant to this job.
  }

  return parsed
}

run(github.context)
