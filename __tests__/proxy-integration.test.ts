import {spawnSync} from 'child_process'
import Docker from 'dockerode'
import fs from 'fs'
import path from 'path'
import {Credential} from '../src/api-client'
import {PROXY_IMAGE_NAME} from '../src/docker-tags'
import {ImageService} from '../src/image-service'
import {ProxyBuilder} from '../src/proxy'
import {integration, removeDanglingUpdaterContainers} from './helpers'

integration('ProxyBuilder', () => {
  const docker = new Docker()
  const jobId = 1
  const jobToken = 'xxxyyyzzzz'
  const dependabotApiUrl = 'http://localhost:9000'
  const credentials: Credential[] = [
    {
      type: 'git_source',
      host: 'github.com',
      username: 'x-access-token',
      password: 'ghp_some_token'
    }
  ]

  const cachedMode = true
  const builder = new ProxyBuilder(docker, PROXY_IMAGE_NAME, cachedMode)

  beforeAll(async () => {
    await ImageService.pull(PROXY_IMAGE_NAME)
  })

  afterEach(async () => {
    await removeDanglingUpdaterContainers()
  })

  jest.setTimeout(20000)
  it('should create a proxy container with the right details', async () => {
    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const containerInfo = await proxy.container.inspect()
    expect(containerInfo.Name).toBe('/dependabot-job-1-proxy')
    expect(containerInfo.Config.Entrypoint).toEqual([
      'sh',
      '-c',
      '/usr/sbin/update-ca-certificates && /dependabot-proxy'
    ])

    expect(proxy.networkName).toBe('dependabot-job-1-internal-network')

    const proxyUrl = await proxy.url()
    expect(proxyUrl).toMatch(/^http:\/\/.+:1080$/)

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

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
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

    await proxy.shutdown()
  })

  jest.setTimeout(20000)
  it('copies in the default node custom root CA if configured', async () => {
    // make a tmp dir at the repo root unless it already exists
    const tmpDir = path.join(__dirname, '../tmp')
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir)
    }
    const certPath = path.join(__dirname, '../tmp/custom-cert.crt')
    fs.writeFileSync(certPath, 'ca-pem-contents')
    process.env.NODE_EXTRA_CA_CERTS = certPath

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
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

    await proxy.shutdown()
  })

  jest.setTimeout(20000)
  it('forwards custom proxy urls if configured', async () => {
    const url = 'http://example.com'
    process.env.HTTP_PROXY = url

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', ['exec', id, 'printenv', 'http_proxy'])
    const output = proc.stdout.toString().trim()
    expect(output).toMatch(url)
  })

  jest.setTimeout(20000)
  it('forwards downcased proxy urls if configured', async () => {
    const url = 'https://example.com'
    process.env.https_proxy = url

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', ['exec', id, 'printenv', 'https_proxy'])
    const output = proc.stdout.toString().trim()
    expect(output).toEqual(url)
  })

  jest.setTimeout(20000)
  it('forwards OIDC token request URL if configured', async () => {
    const url =
      'https://vstoken.actions.githubusercontent.com/_apis/distributedtask/hubs/build/plans/123/jobs/456/oidctoken'
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = url

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', [
      'exec',
      id,
      'printenv',
      'ACTIONS_ID_TOKEN_REQUEST_URL'
    ])
    const output = proc.stdout.toString().trim()
    expect(output).toEqual(url)

    await proxy.shutdown()
  })

  jest.setTimeout(20000)
  it('forwards OIDC token request token if configured', async () => {
    const token = 'e30='
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = token

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', [
      'exec',
      id,
      'printenv',
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN'
    ])
    const output = proc.stdout.toString().trim()
    expect(output).toEqual(token)

    await proxy.shutdown()
  })

  jest.setTimeout(20000)
  it('forwards OPENSSL_FORCE_FIPS_MODE if configured', async () => {
    process.env.OPENSSL_FORCE_FIPS_MODE = '0'

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', [
      'exec',
      id,
      'printenv',
      'OPENSSL_FORCE_FIPS_MODE'
    ])
    const output = proc.stdout.toString().trim()
    expect(output).toEqual('0')

    await proxy.shutdown()
    delete process.env.OPENSSL_FORCE_FIPS_MODE
  })

  jest.setTimeout(20000)
  it('does not set OPENSSL_FORCE_FIPS_MODE when not configured', async () => {
    delete process.env.OPENSSL_FORCE_FIPS_MODE

    const proxy = await builder.run(
      jobId,
      jobToken,
      dependabotApiUrl,
      credentials
    )
    await proxy.container.start()

    const id = proxy.container.id
    const proc = spawnSync('docker', [
      'exec',
      id,
      'printenv',
      'OPENSSL_FORCE_FIPS_MODE'
    ])
    // printenv exits with 1 when the variable is not set
    expect(proc.status).toEqual(1)
    expect(proc.stdout.toString().trim()).toEqual('')

    await proxy.shutdown()
  })
})
