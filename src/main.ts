import * as core from '@actions/core'
import * as github from '@actions/github'
import {getJobParameters} from './inputs'
import Docker from 'dockerode'
import {Updater} from './updater'
import {APIClient} from './api-client'
import axios from 'axios'

async function run(): Promise<void> {
  try {
    // Decode JobParameters:
    const params = getJobParameters(github.context)
    if (params === null) {
      return
    }
    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    const docker = new Docker()
    const client = axios.create({baseURL: params.dependabotAPIURL})
    const api = new APIClient(client, params)
    const updater = new Updater(docker, api)
    await updater.pullImage()

    await updater.runUpdater()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
