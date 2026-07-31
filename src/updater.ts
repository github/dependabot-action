import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService, UpdaterPhase} from './container-service'
import {
  DependencyFile,
  FetchedFiles,
  FileUpdaterInput,
  FileFetcherInput
} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'
import {UpdaterBuilder} from './updater-builder'
import {base64DecodeDependencyFile} from './utils'

// Experiment which opts a job into running the fetch and update phases in
// separate containers, each with its own proxy and credential set.
const FEATURE_SPLIT_FETCH_UPDATE = 'split-fetch-update-containers'

export class UpdaterFetchError extends Error {
  constructor(msg: string) {
    super(msg)
    Object.setPrototypeOf(this, UpdaterFetchError.prototype)
  }
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
      return true
    } finally {
      await this.cleanup(proxy)
    }
  }

  /**
   * Run the job as two sequential containers. The fetch container clones the
   * repository behind a proxy holding the target-repo credential and hands off
   * the file subset it selected. The update container then runs the package
   * manager against only that subset, behind its own proxy.
   */
  private async runSplitPhaseUpdate(): Promise<boolean> {
    const files = await this.runFetchPhase()
    await this.runUpdatePhase(files)
    return true
  }

  private async runFetchPhase(): Promise<FetchedFiles> {
    core.info(`Fetching files for job ${this.apiClient.params.jobId}`)

    const proxy = await this.startProxy(this.credentials, 'fetch')

    try {
      const name = `dependabot-job-${this.apiClient.params.jobId}-file-fetcher`
      const container = await this.createContainer(
        proxy,
        name,
        {job: this.details},
        'fetch'
      )

      const output = await ContainerService.runFileFetcher(container)
      if (!output) {
        throw new UpdaterFetchError(
          'No output.json created by the fetcher container'
        )
      }

      const fileFetcherOutput = JSON.parse(output)

      return {
        base_commit_sha: fileFetcherOutput.base_commit_sha,
        base64_dependency_files: fileFetcherOutput.base64_dependency_files,
        dependency_files: fileFetcherOutput.base64_dependency_files.map(
          (file: DependencyFile) => base64DecodeDependencyFile(file)
        )
      }
    } finally {
      // Tear the fetch proxy and its networks down before the update phase
      // starts, so the two phases never share a proxy or a network.
      await this.cleanup(proxy)
    }
  }

  private async runUpdatePhase(files: FetchedFiles): Promise<void> {
    core.info(`Running update job ${this.apiClient.params.jobId}`)

    const proxy = await this.startProxy(this.updatePhaseCredentials(), 'update')

    try {
      const name = `dependabot-job-${this.apiClient.params.jobId}-updater`
      const input: FileUpdaterInput = {
        base_commit_sha: files.base_commit_sha,
        base64_dependency_files: files.base64_dependency_files,
        dependency_files: files.dependency_files,
        job: this.details
      }
      const container = await this.createContainer(proxy, name, input, 'update')

      await ContainerService.runFileUpdater(container, this.details.command)
    } finally {
      await this.cleanup(proxy)
    }
  }

  /**
   * The credential set handed to the update phase's proxy. Credentials which
   * resolve to the target repository are dropped, since the update phase works
   * from the file subset handed over by the fetch phase rather than the repo.
   */
  private updatePhaseCredentials(): Credential[] {
    const targetRepo = this.details.source?.repo

    const credentials = this.credentials.filter(
      credential => !this.canReadTargetRepo(credential, targetRepo)
    )

    const dropped = this.credentials.length - credentials.length
    if (dropped > 0) {
      core.info(
        `Excluding ${dropped} target-repo credential(s) from the update phase proxy`
      )
    }

    return credentials
  }

  private canReadTargetRepo(
    credential: Credential,
    targetRepo: string | undefined
  ): boolean {
    if (credential.type !== 'git_source') {
      return false
    }

    // A git_source credential scoped to a different repository does not resolve
    // to the target repo, so it is kept for git-sourced dependencies.
    if (credential.repo && targetRepo && credential.repo !== targetRepo) {
      return false
    }

    return true
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
    await proxy.waitUntilReady()

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
    input: FileFetcherInput | FileUpdaterInput,
    phase: UpdaterPhase = 'all'
  ): Promise<Container> {
    return new UpdaterBuilder(
      this.docker,
      this.apiClient.params,
      input,
      proxy,
      this.updaterImage,
      phase
    ).run(containerName)
  }

  private async cleanup(proxy: Proxy): Promise<void> {
    await proxy.shutdown()
  }
}
