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

export class Updater {
  docker: Docker

  constructor(
    private readonly updaterImage: string,
    private readonly proxyImage: string,
    private readonly apiClient: ApiClient,
    private readonly details: JobDetails,
    private readonly credentials: Credential[],
    private readonly outputFolder = 'output/'
  ) {
    this.docker = new Docker()
  }

  /**
   * Execute an update job and report the result to Dependabot API.
   */
  async runUpdater(): Promise<boolean> {
    const proxy = await new ProxyBuilder(this.docker, this.proxyImage).run(
      this.details,
      this.credentials
    )
    proxy.container.start()

    try {
      const files = await this.runFileFetcher(proxy)
      await this.runFileUpdater(proxy, files)
      return true
    } finally {
      await proxy.shutdown()
      await this.docker.pruneNetworks()
    }
  }

  private async runFileFetcher(proxy: Proxy): Promise<FetchedFiles> {
    const container = await this.createContainer(proxy, 'fetch_files')
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

    const outputPath = path.join(__dirname, '../output/output.json')
    if (!fs.existsSync(outputPath)) {
      throw new Error('No output.json created by the fetcher container')
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
    const container = await this.createContainer(proxy, 'update_files')
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
    updaterCommand: string
  ): Promise<Container> {
    const cmd = `(echo > /etc/ca-certificates.conf) &&\
     rm -Rf /usr/share/ca-certificates/ &&\
      /usr/sbin/update-ca-certificates &&\
       $DEPENDABOT_HOME/dependabot-updater/bin/run ${updaterCommand}`

    const container = await this.docker.createContainer({
      Image: this.updaterImage,
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
        NetworkMode: proxy.networkName,
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
