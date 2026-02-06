import * as core from '@actions/core'
import * as github from '@actions/github'
import * as httpClient from '@actions/http-client'
import {Context} from '@actions/github/lib/context'
import {
  ApiClient,
  Credential,
  CredentialFetchingError,
  JobDetails
} from './api-client'
import {getJobParameters} from './inputs'
import {ImageService, MetricReporter} from './image-service'
import {updaterImageName, PROXY_IMAGE_NAME} from './docker-tags'
import {Updater} from './updater'

export enum DependabotErrorType {
  Unknown = 'actions_workflow_unknown',
  Image = 'actions_workflow_image',
  UpdateRun = 'actions_workflow_updater'
}

const FALLBACK_CONTAINER_REGISTRY =
  'dependabot-acr-apim-production.azure-api.net'

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
    let updaterImage =
      params.updaterImage || updaterImageName(details['package-manager'])
    let proxyImage = PROXY_IMAGE_NAME

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

      const packagesCred = getPackagesCredential(details, context.actor)
      if (packagesCred !== null) {
        core.info('Adding GitHub Packages credential')
        credentials.push(packagesCred)
      }

      core.startGroup('Pulling updater images')
      let imagesPulled = false

      try {
        // Using sendMetricsWithPackageManager wrapper to inject package manager tag ti
        // avoid passing additional parameters to ImageService.pull method
        await ImageService.pull(updaterImage, sendMetricsWithPackageManager)
        await ImageService.pull(proxyImage, sendMetricsWithPackageManager)
        imagesPulled = true
      } catch {
        core.warning('Primary image pull failed, attempting fallback')
      }

      if (!imagesPulled) {
        updaterImage = `${FALLBACK_CONTAINER_REGISTRY}/${updaterImage}`
        proxyImage = `${FALLBACK_CONTAINER_REGISTRY}/${proxyImage}`
        try {
          await ImageService.pull(updaterImage, sendMetricsWithPackageManager)
          await ImageService.pull(proxyImage, sendMetricsWithPackageManager)
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
      }
      core.endGroup()

      try {
        core.info('Starting update process')

        const updater = new Updater(
          updaterImage,
          proxyImage,
          apiClient,
          details,
          credentials
        )

        await updater.runUpdater()
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

export function getPackagesCredential(
  jobDetails: JobDetails,
  actor: string
): Credential | null {
  const experiments =
    (jobDetails?.experiments as {[key: string]: boolean}) || {}
  const experimentName = 'automatic_github_packages_auth'
  const alternateExperimentName = experimentName.replace(/_/g, '-')
  const autoAuthWithPackages =
    experiments[experimentName] ?? experiments[alternateExperimentName] ?? false
  if (!autoAuthWithPackages) {
    return null
  }

  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    core.warning(
      'GITHUB_TOKEN is not set; cannot create GitHub Packages credential'
    )
    return null
  }

  core.setSecret(githubToken)

  let credential: Credential | null = null
  switch (jobDetails['package-manager']) {
    case 'bundler':
      credential = getRubyGemsPackagesCredential(jobDetails, actor, githubToken)
      break
    case 'docker':
      credential = getDockerPackagesCredential(jobDetails, actor, githubToken)
      break
    case 'maven':
      credential = getMavenPackagesCredential(jobDetails, actor, githubToken)
      break
    case 'npm_and_yarn':
      credential = getNpmPackagesCredential(jobDetails, actor, githubToken)
      break
    case 'nuget':
      credential = getNuGetPackagesCredential(jobDetails, actor, githubToken)
      break
  }

  return credential
}

function getRubyGemsPackagesCredential(
  jobDetails: JobDetails,
  actor: string,
  githubToken: string
): Credential | null {
  const host = 'rubygems.pkg.github.com'
  const existingIndex = jobDetails['credentials-metadata'].findIndex(
    c => c.type === 'rubygems_server' && (c.host || '').toLowerCase() === host
  )
  if (existingIndex !== -1) {
    return null
  }

  // proxy expects `host` and `token` fields
  return {
    type: 'rubygems_server',
    host,
    token: `${actor}:${githubToken}`
  }
}

function getDockerPackagesCredential(
  jobDetails: JobDetails,
  actor: string,
  githubToken: string
): Credential | null {
  const registry = 'ghcr.io'
  const existingIndex = jobDetails['credentials-metadata'].findIndex(
    c =>
      c.type === 'docker_registry' &&
      (c.registry || '').toLowerCase() === registry
  )
  if (existingIndex !== -1) {
    return null
  }

  // proxy expects `registry`, `username`, and `password` fields
  return {
    type: 'docker_registry',
    registry,
    username: actor,
    password: githubToken
  }
}

function getMavenPackagesCredential(
  jobDetails: JobDetails,
  actor: string,
  githubToken: string
): Credential | null {
  const url = `https://maven.pkg.github.com/${jobDetails.source.repo.split('/')[0]}`
  const existingIndex = jobDetails['credentials-metadata'].findIndex(
    c =>
      c.type === 'maven_repository' &&
      (c.url || '').toLowerCase().replace(/\/$/, '') === url.toLowerCase()
  )
  if (existingIndex !== -1) {
    return null
  }

  // proxy expects `url`, `username`, and `password` fields
  return {
    type: 'maven_repository',
    url,
    username: actor,
    password: githubToken
  }
}

function getNpmPackagesCredential(
  jobDetails: JobDetails,
  actor: string,
  githubToken: string
): Credential | null {
  const registry = 'npm.pkg.github.com'
  const existingIndex = jobDetails['credentials-metadata'].findIndex(
    c =>
      c.type === 'npm_registry' && (c.registry || '').toLowerCase() === registry
  )
  if (existingIndex !== -1) {
    return null
  }

  // proxy expects `registry` and `token` fields
  return {
    type: 'npm_registry',
    registry,
    token: `${actor}:${githubToken}`
  }
}

function getNuGetPackagesCredential(
  jobDetails: JobDetails,
  actor: string,
  githubToken: string
): Credential | null {
  const orgName = jobDetails.source.repo.split('/')[0]
  const feedUrl = `https://nuget.pkg.github.com/${orgName}/index.json`
  const existingIndex = jobDetails['credentials-metadata'].findIndex(
    c =>
      c.type === 'nuget_feed' &&
      (c.url || '').toLowerCase() === feedUrl.toLowerCase()
  )
  if (existingIndex !== -1) {
    return null
  }

  // proxy expects `url` and allows either `token` or `username` and `password` fields
  return {
    type: 'nuget_feed',
    url: feedUrl,
    username: actor,
    password: githubToken
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
