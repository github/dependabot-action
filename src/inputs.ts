import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {WorkflowDispatchEvent} from '@octokit/webhooks-definitions/schema'
import {JobParameters} from './api-client'

export function getJobParameters(ctx: Context): JobParameters | null {
  core.debug(`Detecting '${ctx.eventName}' event.`)

  switch (ctx.eventName) {
    case 'dynamic':
    case 'workflow_dispatch':
      return fromWorkflowInputs(ctx)
  }
  core.info(
    `Dependabot Updater Action does not support '${ctx.eventName}' events.`
  )
  return null
}

function fromWorkflowInputs(ctx: Context): JobParameters {
  const evt = ctx.payload as WorkflowDispatchEvent

  core.debug(JSON.stringify(evt.inputs))

  const dependabotApiDockerUrl =
    evt.inputs.dependabotApiDockerUrl || evt.inputs.dependabotApiUrl

  return new JobParameters(
    parseInt(evt.inputs.jobId as string, 10),
    evt.inputs.jobToken as string,
    evt.inputs.credentialsToken as string,
    evt.inputs.dependabotApiUrl as string,
    dependabotApiDockerUrl as string
  )
}
