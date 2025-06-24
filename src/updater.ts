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
    this.details['credentials-metadata'] = this.generateCredentialsMetadata()
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
      this.apiClient.getJobToken(),
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

  private generateCredentialsMetadata(): Credential[] {
    const unique: Set<string> = new Set()
    const result: Credential[] = []
    for (const credential of this.credentials) {
      if (credential.type === 'jit_access') {
        continue
      }

      const obj: any = {type: credential.type}
      if (credential.host !== undefined) {
        obj.host = credential.host
      }
      if (credential.registry !== undefined) {
        obj.registry = credential.registry
      }
      if (credential['index-url'] !== undefined) {
        obj['index-url'] = credential['index-url']
      }
      if (credential['env-key'] !== undefined) {
        obj['env-key'] = credential['env-key']
      }
      if (credential.url !== undefined) {
        obj.url = credential.url
      }
      if (credential.organization !== undefined) {
        obj.organization = credential.organization
      }
      if (credential['replaces-base'] !== undefined) {
        obj['replaces-base'] = credential['replaces-base']
      }
      if (credential['public-key-fingerprint'] !== undefined) {
        obj['public-key-fingerprint'] = credential['public-key-fingerprint']
      }
      if (credential.repo !== undefined) {
        obj.repo = credential.repo
      }
      const key = JSON.stringify(obj)
      if (!unique.has(key)) {
        unique.add(key)
        result.push(obj as Credential)
      }
    }
    return result
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
      fs.rmSync(this.outputHostPath, {recursive: true})
    }

    if (fs.existsSync(this.repoHostPath)) {
      fs.rmSync(this.repoHostPath, {recursive: true})
    }
  }
}
