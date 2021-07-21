import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {
  RepositoryDispatchEvent,
  WorkflowDispatchEvent
} from '@octokit/webhooks-definitions/schema'
import {JobParameters} from './dependabot-api'

// FIXME: '@octokit/webhooks-definitions' assumes this is the only repository_dispatch event type, workaround that
// https://github.com/octokit/webhooks/blob/0b04a009507aa35811e91a10703bbb2a33bdeff4/payload-schemas/schemas/repository_dispatch/on-demand-test.schema.json#L14
export const DISPATCH_EVENT_NAME = 'on-demand-test'

export function getJobParameters(ctx: Context): JobParameters | null {
  switch (ctx.eventName) {
    case 'dynamic':
    case 'workflow_dispatch':
      return fromWorkflowInputs(ctx)
    case 'repository_dispatch':
      return fromRepoDispatch(ctx)
  }
  core.debug(`Unknown event name: ${ctx.eventName}`)
  return null
}

function fromWorkflowInputs(ctx: Context): JobParameters {
  const evt = ctx.payload as WorkflowDispatchEvent
  return new JobParameters(
    parseInt(evt.inputs.jobID as string, 10),
    evt.inputs.jobToken as string,
    evt.inputs.credentialsToken as string,
    evt.inputs.dependabotAPI as string
  )
}

function fromRepoDispatch(ctx: Context): JobParameters | null {
  const evt = ctx.payload as RepositoryDispatchEvent
  if (evt.action !== DISPATCH_EVENT_NAME) {
    core.debug(`skipping repository_dispatch for ${evt.action}`)
    return null
  }
  const payload = evt.client_payload
  return new JobParameters(
    payload.jobID as number,
    payload.jobToken as string,
    payload.credentialsToken as string,
    payload.dependabotAPI as string
  )
}
