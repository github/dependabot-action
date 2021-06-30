import * as core from '@actions/core'
import * as Docker from 'dockerode'
import {Credential, JobDetails, DependabotAPI} from './dependabot-api'
import {Readable} from 'stream'
import {pack} from 'tar-stream'

const JOB_INPUT_FILENAME = 'job.json'
const JOB_INPUT_PATH = `/home/dependabot/dependabot-updater`

const JOB_OUTPUT_PATH = '/home/dependabot/dependabot-updater/output.json'
const DEFAULT_UPDATER_IMAGE = 'dependabot/dependabot-updater:0.156.4'

export class Updater {
  constructor(
    private readonly docker: Docker,
    private readonly dependabotAPI: DependabotAPI,
    private readonly updaterImage = DEFAULT_UPDATER_IMAGE
  ) {}

  /** Fetch the configured updater image, if it isn't already available. */
  async pullImage(force = false): Promise<void> {
    try {
      const image = await this.docker.getImage(this.updaterImage).inspect()
      if (!force) {
        core.info(`Resolved ${this.updaterImage} to existing ${image.Id}`)
        return
      } // else fallthrough to pull
    } catch (e) {
      if (!e.message.includes('no such image')) {
        throw e
      } // else fallthrough to pull
    }

    core.info(`Pulling image ${this.updaterImage}...`)
    const stream = await this.docker.pull(this.updaterImage)
    await this.endOfStream(stream)
    core.info(`Pulled image ${this.updaterImage}`)
  }

  private async endOfStream(stream: Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error) =>
        err ? reject(err) : resolve(undefined)
      )
    })
  }

  /**
   * Execute an update job and report the result to Dependabot API.
   */
  async runUpdater(): Promise<void> {
    try {
      const details = await this.dependabotAPI.getJobDetails()
      const credentials: Credential[] = [] // TODO: fetch credentials from API
      const files = await this.runFileFetcher(details, credentials)
      await this.runFileUpdater(details, files)
    } catch (e) {
      // TODO: report job runner_error?
      core.error(`Error ${e}`)
    }
  }

  private async runFileFetcher(
    details: JobDetails,
    credentials: Credential[]
  ): Promise<FetchedFiles> {
    const container = await this.createContainer(details, 'fetch_files')
    await this.storeContainerInput(container, {
      job: details,
      credentials
    })
    await this.runContainer(container)

    // TODO: extract files from container
    return {
      base_commit_sha: '',
      dependency_files: [],
      base64_dependency_files: []
    }
  }

  private async runFileUpdater(
    details: JobDetails,
    files: FetchedFiles
  ): Promise<void> {
    core.info(`running update ${details.id} ${files}`)
  }

  private async createContainer(
    details: JobDetails,
    updaterCommand: string
  ): Promise<Docker.Container> {
    const container = await this.docker.createContainer({
      Image: this.updaterImage,
      AttachStdout: true,
      AttachStderr: true,
      Env: [
        `DEPENDABOT_JOB_ID=${details.id}`,
        `DEPENDABOT_JOB_TOKEN=${this.dependabotAPI.params.jobToken}`,
        `DEPENDABOT_JOB_PATH=${JOB_INPUT_PATH}/${JOB_INPUT_FILENAME}`,
        `DEPENDABOT_OUTPUT_PATH=${JOB_OUTPUT_PATH}`,
        `DEPENDABOT_API_URL=${this.dependabotAPI}`
      ],
      Cmd: ['bin/run', 'fetch_files']
    })

    core.info(`Created ${updaterCommand} container: ${container.id}`)
    return container
  }

  private async storeContainerInput(
    container: Docker.Container,
    input: FileFetcherInput | FileUpdaterInput
  ): Promise<void> {
    const tar = pack()
    tar.entry({name: JOB_INPUT_FILENAME}, JSON.stringify(input))
    tar.finalize()
    await container.putArchive(tar, {path: JOB_INPUT_PATH})
  }

  private async runContainer(container: Docker.Container): Promise<void> {
    try {
      await container.start()
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      })
      container.modem.demuxStream(stream, process.stdout, process.stderr)

      await container.wait()
    } finally {
      await container.remove()
      core.info(`Cleaned up container ${container.id}`)
    }
  }
}

type FileFetcherInput = {
  job: JobDetails
  credentials: Credential[]
}

type FetchedFiles = {
  base_commit_sha: string
  dependency_files: any[]
  base64_dependency_files: any[]
}

type FileUpdaterInput = FetchedFiles & {
  job: JobDetails
}
