import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import path from 'path'
import fs from 'fs'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService} from './container-service'
import {base64DecodeDependencyFile} from './utils'
import {DependencyFile, FetchedFiles, FileUpdaterInput} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'

const JOB_INPUT_FILENAME = 'job.json'
const JOB_INPUT_PATH = `/home/dependabot/dependabot-updater`
const JOB_OUTPUT_FILENAME = 'output.json'
const JOB_OUTPUT_PATH = '/home/dependabot/dependabot-updater/output'
const REPO_CONTENTS_PATH = '/home/dependabot/dependabot-updater/repo'
const CA_CERT_INPUT_PATH = '/usr/local/share/ca-certificates'
const CA_CERT_FILENAME = 'dbot-ca.crt'

export class UpdaterFetchError extends Error {
  constructor(msg: string) {
    super(msg)
    Object.setPrototypeOf(this, UpdaterFetchError.prototype)
  }
}

export class Updater {
  docker: Docker
  outputHostPath: string
  repoHostPath: string

  constructor(
    private readonly updaterImage: string,
    private readonly proxyImage: string,
    private readonly apiClient: ApiClient,
    private readonly details: JobDetails,
    private readonly credentials: Credential[],
    private readonly workingDirectory: string
  ) {
    this.docker = new Docker()
    this.outputHostPath = path.join(workingDirectory, 'output')
    this.repoHostPath = path.join(workingDirectory, 'repo')
  }

  /**
   * Execute an update job and report the result to Dependabot API.
   */
  async runUpdater(): Promise<boolean> {
    // Create required folders in the workingDirectory
    fs.mkdirSync(this.outputHostPath)
    fs.mkdirSync(this.repoHostPath)

    const proxy = await new ProxyBuilder(this.docker, this.proxyImage).run(
      this.apiClient.params.jobId,
      this.credentials
    )
    proxy.container.start()

    try {
      const files = await this.runFileFetcher(proxy)
      await this.runFileUpdater(proxy, files)
      return true
    } finally {
      await this.cleanup(proxy)
    }
  }

  private async runFileFetcher(proxy: Proxy): Promise<FetchedFiles> {
    const name = `dependabot-job-${this.apiClient.params.jobId}-file-fetcher`
    const container = await this.createContainer(proxy, name, 'fetch_files')
    await ContainerService.storeInput(
      JOB_INPUT_FILENAME,
      JOB_INPUT_PATH,
      container,
      {job: this.details}
    )
    await ContainerService.storeCert(
      CA_CERT_FILENAME,
      CA_CERT_INPUT_PATH,
      container,
      proxy.cert
    )

    await ContainerService.run(container)

    const outputPath = path.join(this.outputHostPath, 'output.json')
    if (!fs.existsSync(outputPath)) {
      throw new UpdaterFetchError(
        'No output.json created by the fetcher container'
      )
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
    proxy: Proxy,
    files: FetchedFiles
  ): Promise<void> {
    core.info(`Running update job ${this.apiClient.params.jobId}`)
    const name = `dependabot-job-${this.apiClient.params.jobId}-updater`
    const container = await this.createContainer(proxy, name, 'update_files')
    const containerInput: FileUpdaterInput = {
      base_commit_sha: files.base_commit_sha,
      base64_dependency_files: files.base64_dependency_files,
      dependency_files: files.dependency_files,
      job: this.details
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
      proxy.cert
    )

    await ContainerService.run(container)
  }

  private async createContainer(
    proxy: Proxy,
    containerName: string,
    updaterCommand: string
  ): Promise<Container> {
    const cmd = `(echo > /etc/ca-certificates.conf) &&\
     rm -Rf /usr/share/ca-certificates/ &&\
      /usr/sbin/update-ca-certificates &&\
       $DEPENDABOT_HOME/dependabot-updater/bin/run ${updaterCommand}`

    const container = await this.docker.createContainer({
      Image: this.updaterImage,
      name: containerName,
      AttachStdout: true,
      AttachStderr: true,
      Env: [
        `DEPENDABOT_JOB_ID=${this.apiClient.params.jobId}`,
        `DEPENDABOT_JOB_TOKEN=${this.apiClient.params.jobToken}`,
        `DEPENDABOT_JOB_PATH=${JOB_INPUT_PATH}/${JOB_INPUT_FILENAME}`,
        `DEPENDABOT_OUTPUT_PATH=${JOB_OUTPUT_PATH}/${JOB_OUTPUT_FILENAME}`,
        `DEPENDABOT_REPO_CONTENTS_PATH=${REPO_CONTENTS_PATH}`,
        `DEPENDABOT_API_URL=${this.apiClient.params.dependabotApiDockerUrl}`,
        `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt`,
        `http_proxy=${proxy.url}`,
        `HTTP_PROXY=${proxy.url}`,
        `https_proxy=${proxy.url}`,
        `HTTPS_PROXY=${proxy.url}`
      ],
      Cmd: ['sh', '-c', cmd],
      HostConfig: {
        Memory: 8 * 1024 * 1024 * 1024, // 8GB in bytes
        NetworkMode: proxy.networkName,
        Binds: [
          `${this.outputHostPath}:${JOB_OUTPUT_PATH}:rw`,
          `${this.repoHostPath}:${REPO_CONTENTS_PATH}:rw`
        ]
      }
    })

    core.info(`Created ${updaterCommand} container: ${container.id}`)
    return container
  }

  private async cleanup(proxy: Proxy): Promise<void> {
    await proxy.shutdown()

    if (fs.existsSync(this.outputHostPath)) {
      fs.rmdirSync(this.outputHostPath, {recursive: true})
    }

    if (fs.existsSync(this.repoHostPath)) {
      fs.rmdirSync(this.repoHostPath, {recursive: true})
    }
  }
}
