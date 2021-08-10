import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import path from 'path'
import fs from 'fs'
import {Credential, JobDetails, APIClient} from './api-client'
import {ContainerService} from './container-service'
import {base64DecodeDependencyFile} from './utils'
import {DependencyFile, FetchedFiles, FileUpdaterInput} from './file-types'
import {Proxy} from './proxy'

const JOB_INPUT_FILENAME = 'job.json'
const JOB_INPUT_PATH = `/home/dependabot/dependabot-updater`
const JOB_OUTPUT_FILENAME = 'output.json'
const JOB_OUTPUT_PATH = '/home/dependabot/dependabot-updater/output'
const REPO_CONTENTS_PATH = '/home/dependabot/dependabot-updater/repo'
const CA_CERT_INPUT_PATH = '/usr/local/share/ca-certificates'
const CA_CERT_FILENAME = 'dbot-ca.crt'

export class Updater {
  docker: Docker
  proxy: Proxy

  constructor(
    private readonly updaterImage: string,
    private readonly proxyImage: string,
    private readonly apiClient: APIClient
  ) {
    this.docker = new Docker()
    this.proxy = new Proxy(this.docker, proxyImage)
  }

  /**
   * Execute an update job and report the result to Dependabot API.
   */
  async runUpdater(): Promise<void> {
    try {
      const details = await this.apiClient.getJobDetails()
      const credentials = await this.apiClient.getCredentials()
      // TODO: once the proxy is set up, remove credentials from the job details
      details.credentials = credentials

      await this.proxy.run(details, credentials)

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
    } finally {
      this.proxy.container?.stop()
      this.proxy.container?.remove()
    }
  }

  private async runFileFetcher(
    details: JobDetails,
    credentials: Credential[]
  ): Promise<void | FetchedFiles> {
    const container = await this.createContainer('fetch_files')
    await ContainerService.storeInput(
      JOB_INPUT_FILENAME,
      JOB_INPUT_PATH,
      container,
      {
        job: details,
        credentials
      }
    )
    await ContainerService.storeCert(
      CA_CERT_FILENAME,
      CA_CERT_INPUT_PATH,
      container,
      this.proxy.cert
    )

    await ContainerService.run(container)

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
        (file: DependencyFile) => base64DecodeDependencyFile(file)
      )
    }

    return fetchedFiles
  }

  private async runFileUpdater(
    details: JobDetails,
    files: FetchedFiles
  ): Promise<void> {
    core.info(`Running update job ${this.apiClient.params.jobID}`)
    const container = await this.createContainer('update_files')
    const containerInput: FileUpdaterInput = {
      base_commit_sha: files.base_commit_sha,
      base64_dependency_files: files.base64_dependency_files,
      dependency_files: files.dependency_files,
      job: details
    }
    await ContainerService.storeInput(
      JOB_INPUT_FILENAME,
      JOB_INPUT_PATH,
      container,
      containerInput
    )
    await ContainerService.storeCert(
      CA_CERT_FILENAME,
      CA_CERT_INPUT_PATH,
      container,
      this.proxy.cert
    )

    await ContainerService.run(container)
  }

  private async createContainer(updaterCommand: string): Promise<Container> {
    core.info(`Proxy: ${this.proxy.url}`)
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
        `DEPENDABOT_API_URL=${this.apiClient.params.dependabotAPIURL}`,
        `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt`,
        `SSL_CERT_DIR=/etc/ssl/certs`,
        `http_proxy=${this.proxy.url}`,
        `HTTP_PROXY=${this.proxy.url}`,
        `https_proxy=${this.proxy.url}`,
        `HTTPS_PROXY=${this.proxy.url}`
      ],
      Cmd: [
        'sh',
        '-c',
        `/usr/sbin/update-ca-certificates && $DEPENDABOT_HOME/dependabot-updater/bin/run ${updaterCommand}`
      ],
      HostConfig: {
        NetworkMode: 'job-test-network',
        Binds: [
          `${path.join(__dirname, '../output')}:${JOB_OUTPUT_PATH}:rw`,
          `${path.join(__dirname, '../repo')}:${REPO_CONTENTS_PATH}:rw`
        ]
      }
    })

    core.info(`Created ${updaterCommand} container: ${container.id}`)
    return container
  }
}
