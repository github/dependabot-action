import {PROXY_IMAGE_NAME, UPDATER_IMAGE_NAME} from '../src/main'
import {ContainerService} from '../src/container-service'
import {ImageService} from '../src/image-service'
import {removeDanglingUpdaterContainers} from './helpers'
import Docker from 'dockerode'
import {Credential, JobDetails} from '../src/api-client'
import {ProxyBuilder} from '../src/proxy'
import path from 'path'
import fs from 'fs'
import {JobParameters} from '../src/inputs'

describe('ContainerService', () => {
  // Skip the test when we haven't preloaded the updater image
  if (process.env.SKIP_INTEGRATION_TESTS) {
    return
  }

  const docker = new Docker()
  const credentials: Credential[] = [
    {
      type: 'git_source',
      host: 'github.com',
      username: 'x-access-token',
      password: 'ghp_some_token'
    }
  ]

  const details: JobDetails = {
    'allowed-updates': [],
    id: '1',
    'package-manager': 'npm_and_yarn'
  }

  const workingDirectory = path.join(
    __dirname,
    '..',
    'tmp',
    './integration_working_directory'
  )

  beforeAll(async () => {
    await ImageService.pull(PROXY_IMAGE_NAME)
    await ImageService.pull(UPDATER_IMAGE_NAME)

    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    await removeDanglingUpdaterContainers()
    fs.rmdirSync(workingDirectory, {recursive: true})
  })

  it('createUpdaterContainer returns a container only connected to the internal network', async () => {
    const outputPath = path.join(workingDirectory, 'output')
    const repoPath = path.join(workingDirectory, 'repo')
    fs.mkdirSync(outputPath)
    fs.mkdirSync(repoPath)

    const proxy = await new ProxyBuilder(docker, PROXY_IMAGE_NAME).run(
      1,
      credentials
    )
    await proxy.container.start()
    const input = {job: details}
    const params = new JobParameters(
      1,
      'job-token',
      'cred-token',
      'https://example.com',
      '172.17.0.1',
      workingDirectory
    )
    const container = await ContainerService.createUpdaterContainer(
      'updater-image-test',
      params,
      docker,
      input,
      outputPath,
      proxy,
      repoPath,
      'fetch_files',
      UPDATER_IMAGE_NAME
    )

    const containerInfo = await container.inspect()

    const networkNames = Object.keys(containerInfo.NetworkSettings.Networks)
    expect(networkNames).toEqual(['dependabot-job-1-internal-network'])

    const network = docker.getNetwork(networkNames[0])
    const networkInfo = await network.inspect()
    expect(networkInfo.Internal).toBe(true)

    await proxy.shutdown()
    await container.remove()
  })
})
