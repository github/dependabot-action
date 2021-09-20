import * as core from '@actions/core'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import {getJobParameters} from './inputs'
import {ImageService} from './image-service'
import {Updater} from './updater'
import {ApiClient} from './api-client'
import axios from 'axios'

export const UPDATER_IMAGE_NAME =
  'docker.pkg.github.com/dependabot/dependabot-updater:latest'
export const PROXY_IMAGE_NAME =
  'docker.pkg.github.com/github/dependabot-update-job-proxy:latest'

export enum DependabotErrorType {
  Unknown = 'actions_workflow_unknown',
  Image = 'actions_workflow_image',
  UpdateRun = 'actions_workflow_updater'
}

export async function run(context: Context): Promise<void> {
  try {
    // Decode JobParameters:
    const params = getJobParameters(context)
    if (params === null) {
      return // No parameters, nothing to do
    }

    core.info('Starting updater')

    core.debug(JSON.stringify(params))

    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    const client = axios.create({baseURL: params.dependabotApiUrl})
    const apiClient = new ApiClient(client, params)

    try {
      core.info('Fetching job details')

      const details = await apiClient.getJobDetails()
      const credentials = await apiClient.getCredentials()
      const updater = new Updater(
        UPDATER_IMAGE_NAME,
        PROXY_IMAGE_NAME,
        apiClient,
        details,
        credentials
      )

      try {
        core.info('Pulling updater and proxy images')

        await ImageService.pull(UPDATER_IMAGE_NAME)
        await ImageService.pull(PROXY_IMAGE_NAME)
      } catch (error) {
        core.error('Error fetching updater and proxy images')

        await failJob(apiClient, error, DependabotErrorType.Image)
        return
      }

      try {
        core.info('Starting update process')

        await updater.runUpdater()
      } catch (error) {
        core.error('Error performing update')
        await failJob(apiClient, error, DependabotErrorType.UpdateRun)
        return
      }
      core.info('🤖 ~fin~')
    } catch (error) {
      // Update Dependabot API on the job failure
      await failJob(apiClient, error)
    }
  } catch (error) {
    // If we've reached this point, we do not have a viable
    // API client to report back to Dependabot API.
    //
    // We output the raw error in the Action logs and defer
    // to workflow_run monitoring to detect the job failure.
    core.setFailed(error)
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
  core.setFailed(error.message)
}

// Run the update in the current Actions context if called directly
if (require.main === module) {
  run(github.context)
}
