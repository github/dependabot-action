import * as core from '@actions/core'
import * as github from '@actions/github'
import {getJobParameters} from './inputs'
import Docker from 'dockerode'
import {runFileFetcher} from './updater/fetcher'
import {pullImage} from './updater/image'
import {DependabotAPI} from './dependabot-api'
import axios from 'axios'

const apiUrl = 'https://38d4f0538147.ngrok.io'

// FIXME: read from JobParameters? at the least this should be an updater (not core)
const updaterImage = 'dependabot/dependabot-core:0.156.3'

async function run(): Promise<void> {
  try {
    // Decode JobParameters:
    const params = getJobParameters(github.context)
    if (params === null) {
      return
    }
    core.setSecret(params.jobToken)
    core.setSecret(params.credentialsToken)

    // Fetch JobParameters:
    const client = axios.create({baseURL: apiUrl})
    const api = new DependabotAPI(client, params)
    const jobDetails = await api.getJobDetails()
    core.info(`Details: ${JSON.stringify(jobDetails)}`)
    // TODO: credentials

    // TODO: the full docker jamboree
    const docker = new Docker()
    await pullImage(docker, updaterImage)
    await runFileFetcher(docker, updaterImage)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
