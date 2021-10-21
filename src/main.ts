import * as core from '@actions/core'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import {getJobParameters} from './inputs'
import {ImageService} from './image-service'
import {Updater, UpdaterFetchError} from './updater'
import {ApiClient} from './api-client'
import axios from 'axios'

export const UPDATER_IMAGE_NAME =
  'docker.pkg.github.com/dependabot/dependabot-updater:v1'
export const PROXY_IMAGE_NAME =
  'docker.pkg.github.com/github/dependabot-update-job-proxy:v1'

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

    jobId = params.jobId
    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    const client = axios.create({baseURL: params.dependabotApiUrl})
    const apiClient = new ApiClient(client, params)

    core.info('Fetching job details')

    // If we fail to succeed in fetching the job details, we cannot be sure the job has entered a 'processing' state,
    // so we do not try attempt to report back an exception if this fails and instead rely on the the workflow run
    // webhook as it anticipates scenarios where jobs have failed while 'enqueued'.
    const details = await apiClient.getJobDetails()

    try {
      const credentials = await apiClient.getCredentials()
      const updater = new Updater(
        UPDATER_IMAGE_NAME,
        PROXY_IMAGE_NAME,
        apiClient,
        details,
        credentials,
        params.workingDirectory
      )

      core.startGroup('Pulling updater images')
      try {
        await ImageService.pull(UPDATER_IMAGE_NAME)
        await ImageService.pull(PROXY_IMAGE_NAME)
      } catch (error) {
        core.error('Error fetching updater images')

        await failJob(apiClient, error, DependabotErrorType.Image)
        return
      }
      core.endGroup()

      try {
        core.info('Starting update process')

        await updater.runUpdater()
      } catch (error) {
        // If we have encountered a UpdaterFetchError, the Updater will already have
        // reported the error and marked the job as processed, so we only need to
        // set an exit status.
        if (error instanceof UpdaterFetchError) {
          setFailed(
            'Dependabot was unable to retrieve the files required to perform the update'
          )
          botSay('finished: unable to fetch files')
          return
        } else {
          core.error('Error performing update')
          await failJob(apiClient, error, DependabotErrorType.UpdateRun)
          return
        }
      }
      botSay('finished')
    } catch (error) {
      await failJob(apiClient, error)
      return
    }
  } catch (error) {
    // If we've reached this point, we do not have a viable
    // API client to report back to Dependabot API.
    //
    // We output the raw error in the Action logs and defer
    // to workflow_run monitoring to detect the job failure.
    setFailed(error)
    botSay('finished: unexpected error')
  }
}

async function failJob(
  apiClient: ApiClient,
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
  setFailed(error.message)
  botSay('finished: error reported to Dependabot')
}

function botSay(message: string): void {
  core.info(`🤖 ~ ${message} ~`)
}

function setFailed(message: string | Error): void {
  core.setFailed(message)
  if (jobId) {
    core.error(
      `For more information see: ${dependabotJobUrl(
        jobId
      )} (write access required)`
    )
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

run(github.context)
