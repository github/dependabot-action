import * as core from '@actions/core'
import * as github from '@actions/github'
import {getInputs} from './inputs'
import Docker from 'dockerode'
import {runFileFetcher} from './updater/fetcher'

async function run(): Promise<void> {
  try {
    const input = getInputs(github.context)
    if (input === null) {
      return
    }
    core.info(`processing job: ${JSON.stringify(input)}`)

    // TODO: api client: fetch job details

    // TODO: the full docker jamboree
    const docker = new Docker()
    await runFileFetcher(docker)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
