import Docker, {Container} from 'dockerode'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService} from './container-service'
import {FileUpdaterInput, FileFetcherInput} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'
import {UpdaterBuilder} from './updater-builder'

export class Updater {
  docker: Docker

  constructor(
    private readonly updaterImage: string,
    private readonly proxyImage: string,
    private readonly apiClient: ApiClient,
    private readonly details: JobDetails,
    private readonly credentials: Credential[]
  ) {
    this.docker = new Docker()
    this.details['credentials-metadata'] = this.generateCredentialsMetadata()
  }

  /**
   * Execute an update job and report the result to Dependabot API.
   */
  async runUpdater(): Promise<boolean> {
    const proxyBuilder = new ProxyBuilder(this.docker, this.proxyImage)

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
      if (credential.url !== undefined) {
        obj.url = credential.url
      }
      this.setRegistryFromUrl(obj, credential)
      if (credential['index-url'] !== undefined) {
        obj['index-url'] = credential['index-url']
      }
      this.setIndexUrlFromUrl(obj, credential)
      if (credential['env-key'] !== undefined) {
        obj['env-key'] = credential['env-key']
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

  private setRegistryFromUrl(obj: Credential, credential: Credential): void {
    const typesThatUseRegistryAsHost = [
      'npm_registry',
      'composer_repository',
      'docker_registry'
    ]

    if (!typesThatUseRegistryAsHost.includes(credential.type)) {
      return
    }

    if (!credential.registry && credential.url) {
      try {
        const parsedURL = new URL(credential.url)
        obj.registry = parsedURL.hostname
        if (credential.type === 'npm_registry') {
          obj.registry += parsedURL.pathname
        }
      } catch {
        // If the URL is invalid, we skip setting the registry
        // as it will fall back to the default registry for the given type (e.g., npm, Docker, or Composer).
      }
    }
  }

  private setIndexUrlFromUrl(obj: Credential, credential: Credential): void {
    if (credential.type !== 'python_index') {
      return
    }
    if (credential['index-url']) {
      return
    }
    if (credential.url) {
      try {
        obj['index-url'] = credential.url
      } catch {
        // If the URL is invalid, we skip setting the index-url
        // as it will fall back to the default index URL for pip.
      }
    }
  }

  private async runUpdate(proxy: Proxy): Promise<void> {
    const name = `dependabot-job-${this.apiClient.params.jobId}`
    const container = await this.createContainer(proxy, name, {
      job: this.details
    })

    await ContainerService.run(container, this.details.command)
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
      proxy,
      this.updaterImage
    ).run(containerName)
  }

  private async cleanup(proxy: Proxy): Promise<void> {
    await proxy.shutdown()
  }
}
