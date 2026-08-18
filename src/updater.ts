import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService, UpdaterPhase} from './container-service'
import {FileFetcherInput} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'
import {UpdaterBuilder} from './updater-builder'

// Experiment which opts a job into running the fetch and update phases in
// separate containers, each with its own proxy and credential set.
const FEATURE_SPLIT_FETCH_UPDATE = 'isolate_fetch_update'

type RepoVolume = {
  name: string
  remove: () => Promise<unknown>
}

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
    if (this.splitPhasesEnabled()) {
      return await this.runSplitPhaseUpdate()
    }

    return await this.runSingleContainerUpdate()
  }

  private splitPhasesEnabled(): boolean {
    const experiments = (this.details.experiments || {}) as {
      [key: string]: unknown
    }
    return experiments[FEATURE_SPLIT_FETCH_UPDATE] === true
  }

  private async runSingleContainerUpdate(): Promise<boolean> {
    const proxy = await this.startProxy(this.credentials)

    try {
      await this.runUpdate(proxy)
    } catch (error) {
      await this.cleanupAfterFailure(proxy, error)
      throw error
    }

    await this.cleanup(proxy)
    return true
  }

  /**
   * Run the job as two sequential containers, copying the fetched checkout
   * from a fetch-only volume into the volume handed to the updater.
   */
  private async runSplitPhaseUpdate(): Promise<boolean> {
    const cloneVolume = (await this.docker.createVolume({
      Name: `dependabot-job-${this.apiClient.params.jobId}-clone`,
      Labels: {'dependabot-job-id': String(this.apiClient.params.jobId)}
    })) as unknown as RepoVolume
    let handoffVolume: RepoVolume

    try {
      handoffVolume = (await this.docker.createVolume({
        Name: `dependabot-job-${this.apiClient.params.jobId}-handoff`,
        Labels: {'dependabot-job-id': String(this.apiClient.params.jobId)}
      })) as unknown as RepoVolume
    } catch (error) {
      await this.removeRepoVolumes([cloneVolume], true)
      throw error
    }

    const repoVolumes = [cloneVolume, handoffVolume]
    try {
      await this.runFetchPhase(cloneVolume.name, handoffVolume.name)
      await this.runUpdatePhase(handoffVolume.name)
    } catch (error) {
      await this.removeRepoVolumes(repoVolumes, true)
      throw error
    }

    await this.removeRepoVolumes(repoVolumes, false)
    return true
  }

  private async runFetchPhase(
    cloneVolume: string,
    handoffVolume: string
  ): Promise<void> {
    core.info(`Fetching files for job ${this.apiClient.params.jobId}`)

    const proxy = await this.startProxy(this.credentials, 'fetch')

    try {
      const name = `dependabot-job-${this.apiClient.params.jobId}-file-fetcher`
      const container = await this.createContainer(
        proxy,
        name,
        {job: this.details},
        'fetch',
        cloneVolume,
        handoffVolume
      )

      await ContainerService.runFileFetcher(container)
    } catch (error) {
      await this.cleanupAfterFailure(proxy, error)
      throw error
    }

    await this.cleanup(proxy)
  }

  private async runUpdatePhase(repoVolume: string): Promise<void> {
    core.info(`Running update job ${this.apiClient.params.jobId}`)

    const proxy = await this.startProxy(this.credentials, 'update')

    try {
      const name = `dependabot-job-${this.apiClient.params.jobId}-updater`
      const container = await this.createContainer(
        proxy,
        name,
        {job: this.details},
        'update',
        repoVolume
      )

      await ContainerService.runFileUpdater(container, this.details.command)
    } catch (error) {
      await this.cleanupAfterFailure(proxy, error)
      throw error
    }

    await this.cleanup(proxy)
  }

  private async startProxy(
    credentials: Credential[],
    phase?: string
  ): Promise<Proxy> {
    const cachedMode = Object.hasOwn(
      this.details.experiments ?? {},
      'proxy-cached'
    )

    const proxyBuilder = new ProxyBuilder(
      this.docker,
      this.proxyImage,
      cachedMode
    )

    const proxy = await proxyBuilder.run(
      this.apiClient.params.jobId,
      this.apiClient.getJobToken(),
      this.apiClient.params.dependabotApiUrl,
      credentials,
      phase
    )
    await proxy.container.start()
    try {
      await proxy.waitUntilReady()
    } catch (error) {
      await this.cleanupAfterFailure(proxy, error)
      throw error
    }

    return proxy
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
      if (credential.scope !== undefined) {
        obj.scope = credential.scope
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
    input: FileFetcherInput,
    phase: UpdaterPhase = 'all',
    repoVolume?: string,
    handoffVolume?: string
  ): Promise<Container> {
    return new UpdaterBuilder(
      this.docker,
      this.apiClient.params,
      input,
      proxy,
      this.updaterImage,
      phase,
      repoVolume,
      handoffVolume
    ).run(containerName)
  }

  private async cleanup(proxy: Proxy): Promise<void> {
    await proxy.shutdown()
  }

  private async cleanupAfterFailure(
    proxy: Proxy,
    originalError: unknown
  ): Promise<void> {
    try {
      await this.cleanup(proxy)
    } catch (cleanupError) {
      const cleanupErrors =
        cleanupError instanceof AggregateError
          ? cleanupError.errors
          : [cleanupError]
      for (const cleanupFailure of cleanupErrors) {
        core.info(
          `Failed to clean up proxy after update failure: ${cleanupFailure}`
        )
      }
      core.debug(`Original updater failure: ${originalError}`)
    }
  }

  private async removeRepoVolumes(
    volumes: RepoVolume[],
    afterFailure: boolean
  ): Promise<void> {
    const results = await Promise.allSettled(
      volumes.map(async volume => volume.remove())
    )
    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason)

    if (errors.length === 0) {
      return
    }

    if (afterFailure) {
      for (const error of errors) {
        core.info(
          `Failed to clean up repository volume after update failure: ${error}`
        )
      }
      return
    }

    if (errors.length === 1) {
      throw errors[0]
    }

    throw new AggregateError(errors, 'Failed to clean up repository volumes')
  }
}
