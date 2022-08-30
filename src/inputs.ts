import fs from 'fs'
import path from 'path'
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
    readonly workingDirectory: string
  ) {}
}

export function getJobParameters(ctx: Context): JobParameters | null {
  checkEnvironmentAndContext(ctx)

  if (ctx.actor !== DEPENDABOT_ACTOR) {
    core.warning('This workflow can only be triggered by Dependabot.')
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

  if (!process.env.GITHUB_WORKSPACE) {
    core.error('GITHUB_WORKSPACE is not defined')
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

  const workingDirectory = absoluteWorkingDirectory(
    evt.inputs.workingDirectory as string
  )

  return new JobParameters(
    parseInt(evt.inputs.jobId as string, 10),
    evt.inputs.jobToken as string,
    evt.inputs.credentialsToken as string,
    evt.inputs.dependabotApiUrl as string,
    dependabotApiDockerUrl as string,
    workingDirectory
  )
}

function absoluteWorkingDirectory(workingDirectory: string): string {
  const workspace = process.env.GITHUB_WORKSPACE as string

  if (!workingDirectory) {
    throw new Error('The workingDirectory input must not be blank.')
  }

  if (!directoryExistsSync(workspace)) {
    throw new Error('The GITHUB_WORKSPACE directory does not exist.')
  }

  const fullPath = path.join(workspace, workingDirectory)

  if (!directoryExistsSync(fullPath)) {
    throw new Error(
      `The workingDirectory '${workingDirectory}' does not exist in GITHUB_WORKSPACE`
    )
  }

  return fullPath
}

function directoryExistsSync(directoryPath: string): boolean {
  let stats: fs.Stats

  try {
    stats = fs.statSync(directoryPath)
    return stats.isDirectory()
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false
    } else if (error instanceof Error) {
      throw new Error(
        `Encountered an error when checking whether path '${directoryPath}' exists: ${error.message}`
      )
    }
  }
  return false
}

function isNodeError(error: any): error is NodeJS.ErrnoException {
  return error instanceof Error
}
