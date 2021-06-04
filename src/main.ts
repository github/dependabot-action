import * as core from '@actions/core'
import * as github from '@actions/github'
import {getInputs} from './inputs'

async function run(): Promise<void> {
  try {
    const input = getInputs(github.context)
    if (input === null) {
      return
    }

    core.info(`processing job: ${JSON.stringify(input)}`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
