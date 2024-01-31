import Docker, {Container} from 'dockerode'
import path from 'path'
import fs from 'fs'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService} from './container-service'
import {FileUpdaterInput, FileFetcherInput} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'
import {UpdaterBuilder} from './updater-builder'

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

    const cachedMode =
      this.details.experiments?.hasOwnProperty('proxy-cached') === true

    const proxyBuilder = new ProxyBuilder(
      this.docker,
      this.proxyImage,
      cachedMode
    )

    const proxy = await proxyBuilder.run(
      this.apiClient.params.jobId,
      this.apiClient.params.dependabotApiUrl,
      this.credentials
    )
    await proxy.container.start()

    try {
      await this.runUpdate(proxy)
      return true
    } finally {
      await this.cleanup(proxy)
    }
  }

  private async runUpdate(proxy: Proxy): Promise<void> {
    const name = `dependabot-job-${this.apiClient.params.jobId}`
    const container = await this.createContainer(proxy, name, {
      job: this.details
    })

    await ContainerService.run(container)
  }

  private async createContainer(
    proxy: Proxy,
    containerName: string,
    input: FileFetcherInput | FileUpdaterInput
  ): Promise<Container> {
    return new UpdaterBuilder(
      this.docker,
      this.apiClient.params,
      input,
      this.outputHostPath,
      proxy,
      this.updaterImage
    ).run(containerName)
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
