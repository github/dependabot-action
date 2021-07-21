import * as core from '@actions/core'
import * as github from '@actions/github'
import {getJobParameters} from './inputs'
import Docker from 'dockerode'
import {runFileFetcher} from './updater/fetcher'
import {DependabotAPI} from './dependabot-api'
import axios from 'axios'

const apiUrl = 'https://38d4f0538147.ngrok.io'

async function run(): Promise<void> {
  try {
    const params = getJobParameters(github.context)
    if (params === null) {
      return
    }
    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    // TODO: api client: fetch job details
    const client = axios.create({baseURL: apiUrl})
    const api = new DependabotAPI(client, params)

    const jobDetails = await api.getJobDetails()
    core.info(`Details: ${JSON.stringify(jobDetails)}`)

    // TODO: the full docker jamboree
    const docker = new Docker()
    await runFileFetcher(docker)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
