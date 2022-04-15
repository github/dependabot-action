import * as core from '@actions/core'
import Docker, {Container} from 'dockerode'
import path from 'path'
import fs from 'fs'
import {JobDetails, ApiClient, Credential} from './api-client'
import {ContainerService} from './container-service'
import {base64DecodeDependencyFile} from './utils'
import {
  DependencyFile,
  FetchedFiles,
  FileUpdaterInput,
  FileFetcherInput
} from './config-types'
import {ProxyBuilder, Proxy} from './proxy'
import {UpdaterBuilder} from './updater-builder'

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
    await proxy.container.start()

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
    const container = await this.createContainer(proxy, name, 'fetch_files', {
      job: this.details
    })

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

    const containerInput: FileUpdaterInput = {
      base_commit_sha: files.base_commit_sha,
      base64_dependency_files: files.base64_dependency_files,
      dependency_files: files.dependency_files,
      job: this.details
    }
    const container = await this.createContainer(
      proxy,
      name,
      'update_files',
      containerInput
    )

    await ContainerService.run(container)
  }

  private async createContainer(
    proxy: Proxy,
    containerName: string,
    updaterCommand: string,
    input: FileFetcherInput | FileUpdaterInput
  ): Promise<Container> {
    return new UpdaterBuilder(
      this.docker,
      this.apiClient.params,
      input,
      this.outputHostPath,
      proxy,
      this.repoHostPath,
      this.updaterImage
    ).run(containerName, updaterCommand)
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
