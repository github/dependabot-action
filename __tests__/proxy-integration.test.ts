import Docker from 'dockerode'
import {Credential} from '../src/api-client'
import {ImageService} from '../src/image-service'
import {PROXY_IMAGE_NAME} from '../src/main'
import {ProxyBuilder} from '../src/proxy'
import {integration, removeDanglingUpdaterContainers} from './helpers'
import {spawnSync} from 'child_process'
import fs from 'fs'
import path from 'path'

integration('ProxyBuilder', () => {
  const docker = new Docker()
  const jobId = 1
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
    await ImageService.pull(PROXY_IMAGE_NAME)
  })

  afterEach(async () => {
    await removeDanglingUpdaterContainers()
  })

  jest.setTimeout(20000)
  it('should create a proxy container with the right details', async () => {
    const proxy = await builder.run(jobId, credentials)
    await proxy.container.start()

    const containerInfo = await proxy.container.inspect()
    expect(containerInfo.Name).toBe('/dependabot-job-1-proxy')
    expect(containerInfo.Config.Entrypoint).toEqual([
      'sh',
      '-c',
      '/usr/sbin/update-ca-certificates && /update-job-proxy'
    ])

    expect(proxy.networkName).toBe('dependabot-job-1-internal-network')

    const proxyUrl = await proxy.url()
    expect(proxyUrl).toMatch(/^http:\/\/1:.+:1080$/)

    const proxyIPAddress =
      containerInfo.NetworkSettings.Networks[proxy.networkName].IPAddress
    expect(proxyIPAddress.length).toBeGreaterThan(0)
    expect(proxyUrl).toContain(proxyIPAddress)

    const networkInfo = await proxy.network.inspect()
    expect(networkInfo.Name).toBe('dependabot-job-1-internal-network')
    expect(networkInfo.Internal).toBe(true)

    const networkNames = Object.keys(containerInfo.NetworkSettings.Networks)
    expect(networkNames).toEqual([
      'dependabot-job-1-external-network',
      'dependabot-job-1-internal-network'
    ])

    // run a bash command that executes docker and returns contents of /config.json
    const id = proxy.container.id
    const proc = spawnSync('docker', ['exec', id, 'cat', '/config.json'])
    const stdout = proc.stdout.toString()
    const config = JSON.parse(stdout)
    expect(config.all_credentials).toEqual(credentials)

    await proxy.shutdown()
  })

  jest.setTimeout(20000)
  it('copies in a custom root CA if configured', async () => {
    // make a tmp dir at the repo root unless it already exists
    const tmpDir = path.join(__dirname, '../tmp')
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir)
    }
    const certPath = path.join(__dirname, '../tmp/custom-cert.crt')
    fs.writeFileSync(certPath, 'ca-pem-contents')
    process.env.CUSTOM_CA_PATH = certPath

    const proxy = await builder.run(jobId, credentials)
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', [
      'exec',
      id,
      'cat',
      '/usr/local/share/ca-certificates/custom-ca-cert.crt'
    ])
    const stdout = proc.stdout.toString()
    expect(stdout).toEqual('ca-pem-contents')
  })
})
