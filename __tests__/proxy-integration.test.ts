import Docker from 'dockerode'
import {Credential, JobDetails, PackageManager} from '../src/api-client'
import {ImageService} from '../src/image-service'
import {PROXY_IMAGE_NAME} from '../src/main'
import {ProxyBuilder} from '../src/proxy'
import {removeDanglingUpdaterContainers} from './helpers'

describe('ProxyBuilder', () => {
  const docker = new Docker()
  const details: JobDetails = {
    id: '1',
    'allowed-updates': [
      {
        'dependency-type': 'all'
      }
    ],
    'package-manager': PackageManager.NpmAndYarn
  }
  const credentials: Credential[] = [
    {
      type: 'git_source',
      host: 'github.com',
      username: 'x-access-token',
      password: 'ghp_some_token'
    }
  ]

  const builder = new ProxyBuilder(docker, PROXY_IMAGE_NAME)

  beforeAll(async () => {
    // Skip the test when we haven't preloaded the updater image
    if (process.env.SKIP_INTEGRATION_TESTS) {
      return
    }
    await ImageService.pull(PROXY_IMAGE_NAME)
  })

  afterEach(async () => {
    await removeDanglingUpdaterContainers()
  })

  it('should create a proxy container with the right details', async () => {
    // Skip the test when we haven't preloaded the updater image
    if (process.env.SKIP_INTEGRATION_TESTS) {
      return
    }

    const proxy = await builder.run(details, credentials)

    expect(proxy.networkName).toBe('job-1-network')
    expect(proxy.url).toMatch(/^http:\/\/1:.+job-1-proxy:1080$/)

    const containerInfo = await proxy.container.inspect()
    expect(containerInfo.Name).toBe('/job-1-proxy')
    expect(containerInfo.HostConfig.NetworkMode).toBe('job-1-network')
    expect(containerInfo.Config.Cmd).toEqual([
      'sh',
      '-c',
      '/usr/sbin/update-ca-certificates && /update-job-proxy'
    ])

    const networkInfo = await proxy.network.inspect()
    expect(networkInfo.Name).toBe('job-1-network')
    expect(networkInfo.Internal).toBe(false)

    await proxy.shutdown()
  })
})
