import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {WorkflowDispatchEvent} from '@octokit/webhooks-types'
import {JobParameters} from './api-client'

const DYNAMIC = 'dynamic'

export function getJobParameters(ctx: Context): JobParameters | null {
  if (ctx.eventName === DYNAMIC) {
    return fromWorkflowInputs(ctx)
  } else {
    core.info(
      `Dependabot Updater Action does not support '${ctx.eventName}' events.`
    )
    return null
  }
}

function fromWorkflowInputs(ctx: Context): JobParameters {
  const evt = ctx.payload as WorkflowDispatchEvent

  if (!evt.inputs) {
    throw new Error('Missing inputs in WorkflowDispatchEvent')
  }

  const dependabotApiDockerUrl =
    evt.inputs.dependabotApiDockerUrl || evt.inputs.dependabotApiUrl

  return new JobParameters(
    parseInt(evt.inputs.jobId as string, 10),
    evt.inputs.jobToken as string,
    evt.inputs.credentialsToken as string,
    evt.inputs.dependabotApiUrl as string,
    dependabotApiDockerUrl as string,
    evt.inputs.workingDirectory as string
  )
}
