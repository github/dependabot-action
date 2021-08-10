import * as core from '@actions/core'
import * as github from '@actions/github'
import {getJobParameters} from './inputs'
import {ImageService} from './image-service'
import {Updater} from './updater'
import {APIClient} from './api-client'
import axios from 'axios'

export const UPDATER_IMAGE_NAME =
  'docker.pkg.github.com/dependabot/dependabot-updater:latest'
export const PROXY_IMAGE_NAME =
  'docker.pkg.github.com/github/dependabot-update-job-proxy:latest'

async function run(): Promise<void> {
  try {
    // Decode JobParameters:
    const params = getJobParameters(github.context)
    if (params === null) {
      return
    }

    core.info(JSON.stringify(params))

    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    const client = axios.create({baseURL: params.dependabotAPIURL})
    const apiClient = new APIClient(client, params)
    const updater = new Updater(UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME, apiClient)
    await ImageService.pull(UPDATER_IMAGE_NAME)
    await ImageService.pull(PROXY_IMAGE_NAME)

    await updater.runUpdater()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
