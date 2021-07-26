import * as core from '@actions/core'
import * as Docker from 'dockerode'
import path from 'path'
import fs from 'fs'
import {Credential, JobDetails, APIClient} from './api-client'
import {Readable} from 'stream'
import {pack} from 'tar-stream'

const JOB_INPUT_FILENAME = 'job.json'
const JOB_INPUT_PATH = `/home/dependabot/dependabot-updater`

const JOB_OUTPUT_FILENAME = 'output.json'
const JOB_OUTPUT_PATH = '/home/dependabot/dependabot-updater/output'
const REPO_CONTENTS_PATH = '/home/dependabot/dependabot-updater/repo'
const DEFAULT_UPDATER_IMAGE =
  'docker.pkg.github.com/dependabot/dependabot-updater:latest'

const decode = (str: string): string =>
  Buffer.from(str, 'base64').toString('binary')

export class Updater {
  constructor(
    private readonly docker: Docker,
    private readonly apiClient: APIClient,
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
    const auth = {
      username: process.env.GITHUB_PKG_USER,
      password: process.env.GITHUB_PKG_TOKEN
    }
    const stream = await this.docker.pull(this.updaterImage, {authconfig: auth})
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
      const details = await this.apiClient.getJobDetails()
      const credentials = await this.apiClient.getCredentials()
      // TODO: once the proxy is set up, remove credentials from the job details
      details['credentials'] = credentials

      const files = await this.runFileFetcher(details, credentials)
      if (!files) {
        core.error(`failed during fetch, skipping updater`)
        // TODO: report job runner_error?
        return
      }

      await this.runFileUpdater(details, files)
    } catch (e) {
      // TODO: report job runner_error?
      core.error(`Error ${e}`)
    }
  }

  private decodeBase64Content(file: DependencyFile): string {
    const fileCopy = JSON.parse(JSON.stringify(file))
    fileCopy.content = decode(fileCopy.content)
    return fileCopy
  }

  private async runFileFetcher(
    details: JobDetails,
    credentials: Credential[]
  ): Promise<void | FetchedFiles> {
    const container = await this.createContainer('fetch_files')
    await this.storeContainerInput(container, {
      job: details,
      credentials
    })
    await this.runContainer(container)

    const outputPath = path.join(__dirname, '../output/output.json')
    if (!fs.existsSync(outputPath)) {
      return
    }

    const fileFetcherSync = fs.readFileSync(outputPath).toString()
    const fileFetcherOutput = JSON.parse(fileFetcherSync)

    const fetchedFiles: FetchedFiles = {
      base_commit_sha: fileFetcherOutput.base_commit_sha,
      base64_dependency_files: fileFetcherOutput.base64_dependency_files,
      dependency_files: fileFetcherOutput.base64_dependency_files.map(
        (file: DependencyFile) => this.decodeBase64Content(file)
      )
    }

    return fetchedFiles
  }

  private async runFileUpdater(
    details: JobDetails,
    files: FetchedFiles
  ): Promise<void> {
    core.info(`running update ${details.id} ${files}`)
    const container = await this.createContainer('update_files')
    const containerInput: FileUpdaterInput = {
      base_commit_sha: files.base_commit_sha,
      base64_dependency_files: files.base64_dependency_files,
      dependency_files: files.dependency_files,
      job: details
    }
    await this.storeContainerInput(container, containerInput)
    await this.runContainer(container)
  }

  private async createContainer(
    updaterCommand: string
  ): Promise<Docker.Container> {
    const container = await this.docker.createContainer({
      Image: this.updaterImage,
      AttachStdout: true,
      AttachStderr: true,
      Env: [
        `DEPENDABOT_JOB_ID=${this.apiClient.params.jobID}`,
        `DEPENDABOT_JOB_TOKEN=${this.apiClient.params.jobToken}`,
        `DEPENDABOT_JOB_PATH=${JOB_INPUT_PATH}/${JOB_INPUT_FILENAME}`,
        `DEPENDABOT_OUTPUT_PATH=${JOB_OUTPUT_PATH}/${JOB_OUTPUT_FILENAME}`,
        `DEPENDABOT_REPO_CONTENTS_PATH=${REPO_CONTENTS_PATH}`,
        `DEPENDABOT_API_URL=${this.apiClient.params.dependabotAPIURL}`
      ],
      Cmd: ['bin/run', updaterCommand],
      HostConfig: {
        Binds: [
          `${path.join(__dirname, '../output')}:${JOB_OUTPUT_PATH}:rw`,
          `${path.join(__dirname, '../repo')}:${REPO_CONTENTS_PATH}:rw`
        ]
      }
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

      const network = this.docker.getNetwork('host')
      network.connect({Container: container}, err => core.info(err))

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

type DependencyFile = {
  name: string
  content: any
  directory: string
  type: string
  support_file: boolean
  content_encoding: string
  deleted: boolean
  operation: string
}

type FileUpdaterInput = FetchedFiles & {
  job: JobDetails
}
