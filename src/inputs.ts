import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {WorkflowDispatchEvent} from '@octokit/webhooks-types'

const DYNAMIC = 'dynamic'
const DEPENDABOT_ACTOR = 'dependabot[bot]'

// JobParameters are the Action inputs required to execute the job
export class JobParameters {
  constructor(
    readonly jobId: number,
    readonly jobToken: string,
    readonly credentialsToken: string,
    readonly dependabotApiUrl: string,
    readonly dependabotApiDockerUrl: string,
    readonly updaterImage: string
  ) {}
}

export function getJobParameters(ctx: Context): JobParameters | null {
  checkEnvironmentAndContext(ctx)

  if (ctx.actor !== DEPENDABOT_ACTOR) {
    core.warning(
      `This workflow can only be triggered by Dependabot. Actor was '${ctx.actor}'.`
    )
    return null
  }

  if (
    process.env.GITHUB_TRIGGERING_ACTOR &&
    process.env.GITHUB_TRIGGERING_ACTOR !== DEPENDABOT_ACTOR
  ) {
    core.warning(
      'Dependabot workflows cannot be re-run. Retrigger this update via Dependabot instead.'
    )
    return null
  }

  if (ctx.eventName === DYNAMIC) {
    return fromWorkflowInputs(ctx)
  } else {
    core.warning(
      `Dependabot Updater Action does not support '${ctx.eventName}' events.`
    )
    return null
  }
}

function checkEnvironmentAndContext(ctx: Context): boolean {
  let valid = true

  if (!ctx.actor) {
    core.error('GITHUB_ACTOR is not defined')
    valid = false
  }

  if (!ctx.eventName) {
    core.error('GITHUB_EVENT_NAME is not defined')
    valid = false
  }

  if (!valid) {
    throw new Error('Required Actions environment variables missing.')
  } else {
    return valid
  }
}

function fromWorkflowInputs(ctx: Context): JobParameters {
  const evt = ctx.payload as WorkflowDispatchEvent

  if (!evt.inputs) {
    throw new Error('Event payload has no inputs')
  }

  const dependabotApiDockerUrl =
    evt.inputs.dependabotApiDockerUrl || evt.inputs.dependabotApiUrl

  return new JobParameters(
    parseInt(evt.inputs.jobId as string, 10),
    evt.inputs.jobToken as string,
    evt.inputs.credentialsToken as string,
    evt.inputs.dependabotApiUrl as string,
    dependabotApiDockerUrl as string,
    evt.inputs.updaterImage as string
  )
}
