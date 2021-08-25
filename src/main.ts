import * as core from '@actions/core'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import {getJobParameters} from './inputs'
import {ImageService} from './image-service'
import {Updater} from './updater'
import {APIClient} from './api-client'
import axios from 'axios'

export const UPDATER_IMAGE_NAME =
  'docker.pkg.github.com/dependabot/dependabot-updater:latest'
export const PROXY_IMAGE_NAME =
  'docker.pkg.github.com/github/dependabot-update-job-proxy:latest'

export async function run(context: Context): Promise<void> {
  try {
    // Decode JobParameters:
    const params = getJobParameters(context)
    if (params === null) {
      return // No parameters, nothing to do
    }

    core.debug(JSON.stringify(params))

    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    const client = axios.create({baseURL: params.dependabotAPIURL})
    const apiClient = new APIClient(client, params)

    try {
      const details = await apiClient.getJobDetails()
      const credentials = await apiClient.getCredentials()
      const updater = new Updater(
        UPDATER_IMAGE_NAME,
        PROXY_IMAGE_NAME,
        apiClient,
        details,
        credentials
      )
      await ImageService.pull(UPDATER_IMAGE_NAME)
      await ImageService.pull(PROXY_IMAGE_NAME)

      await updater.runUpdater()
      core.info('🤖 ~fin~')
    } catch (error) {
      // Update Dependabot API on the job failure
      apiClient.failJob(error)
      core.setFailed(error.message)
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

run(github.context)
