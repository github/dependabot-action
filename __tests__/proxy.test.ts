import * as core from '@actions/core'
import Docker, {Container, Network} from 'dockerode'
import {PassThrough} from 'node:stream'
import {ApiClient, JobDetails} from '../src/api-client'
import {ContainerService} from '../src/container-service'
import {Proxy, ProxyBuilder} from '../src/proxy'
import {Updater} from '../src/updater'

type ProxyTestResources = {
  container: Container
  containerRemove: jest.Mock
  createContainer: jest.Mock
  externalNetworkRemove: jest.Mock
  internalNetworkRemove: jest.Mock
  proxy: Proxy
}

const alreadyStoppedError = (): Error =>
  Object.assign(new Error('container is already stopped'), {statusCode: 304})

async function buildProxyWithStopError(
  stopError: Error,
  containerRemoveError?: Error,
  containerRemoveOverride?: jest.Mock,
  experiments: object = {}
): Promise<ProxyTestResources> {
  const containerRemove =
    containerRemoveOverride ??
    (containerRemoveError
      ? jest.fn().mockRejectedValue(containerRemoveError)
      : jest.fn().mockResolvedValue(undefined))
  const container = {
    id: 'proxy-container',
    attach: jest.fn().mockResolvedValue(new PassThrough()),
    modem: {demuxStream: jest.fn()},
    putArchive: jest.fn().mockResolvedValue(undefined),
    inspect: jest
      .fn()
      .mockRejectedValue(new Error('host cannot reach the internal IP')),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockRejectedValue(stopError),
    remove: containerRemove
  } as unknown as Container
  const externalNetworkRemove = jest.fn().mockResolvedValue(undefined)
  const externalNetwork = {
    connect: jest.fn().mockResolvedValue(undefined),
    remove: externalNetworkRemove
  } as unknown as Network
  const internalNetworkRemove = jest.fn().mockResolvedValue(undefined)
  const internalNetwork = {
    remove: internalNetworkRemove
  } as unknown as Network
  const createContainer = jest.fn().mockResolvedValue(container)
  const docker = {
    listNetworks: jest.fn().mockResolvedValue([]),
    createNetwork: jest
      .fn()
      .mockResolvedValueOnce(externalNetwork)
      .mockResolvedValueOnce(internalNetwork),
    createContainer
  } as unknown as Docker
  const proxy = await new ProxyBuilder(docker, 'proxy-image', experiments).run(
    1,
    'job-token',
    'https://dependabot-api.example.com',
    []
  )

  return {
    container,
    containerRemove,
    createContainer,
    externalNetworkRemove,
    internalNetworkRemove,
    proxy
  }
}

function buildUpdaterWithProxy(proxy: Proxy): {
  updater: Updater
  restoreProxyBuilder: () => void
} {
  const proxyBuilderRun = jest
    .spyOn(ProxyBuilder.prototype, 'run')
    .mockResolvedValue(proxy)
  const apiClient = {
    params: {
      jobId: 1,
      dependabotApiUrl: 'https://dependabot-api.example.com'
    },
    getJobToken: jest.fn().mockReturnValue('job-token')
  } as unknown as ApiClient
  const jobDetails: JobDetails = {
    id: '1',
    'allowed-updates': [],
    'package-manager': 'npm_and_yarn',
    'credentials-metadata': [],
    experiments: {},
    source: {repo: 'github/dependabot-action'}
  }

  return {
    updater: new Updater(
      'updater-image',
      'proxy-image',
      apiClient,
      jobDetails,
      []
    ),
    restoreProxyBuilder: () => proxyBuilderRun.mockRestore()
  }
}

describe('Proxy config', () => {
  it('forwards experiments without changing their names or values', async () => {
    const experiments = {
      'proxy-read-only-git-credentials': true,
      disabled: false,
      timeout: 30,
      mode: 'strict',
      configuration: {enabled: true}
    }
    const storeInput = jest
      .spyOn(ContainerService, 'storeInput')
      .mockResolvedValue(undefined)

    try {
      await buildProxyWithStopError(
        alreadyStoppedError(),
        undefined,
        undefined,
        experiments
      )

      expect(storeInput).toHaveBeenCalledWith(
        'config.json',
        '/',
        expect.anything(),
        expect.objectContaining({
          all_credentials: [],
          experiments
        })
      )
    } finally {
      storeInput.mockRestore()
    }
  })
})

describe('Proxy environment', () => {
  it('always enables the proxy cache', async () => {
    const {createContainer} = await buildProxyWithStopError(
      alreadyStoppedError()
    )

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining(['PROXY_CACHE=true'])
      })
    )
  })
})

describe('Proxy readiness', () => {
  it('checks readiness inside the proxy container network namespace', async () => {
    const {container, proxy} = await buildProxyWithStopError(
      alreadyStoppedError()
    )
    const execCommand = jest
      .spyOn(ContainerService, 'execCommand')
      .mockResolvedValue(undefined)

    await expect(proxy.waitUntilReady()).resolves.toBeUndefined()
    expect(execCommand).toHaveBeenCalledWith(
      container,
      expect.arrayContaining([
        expect.stringContaining('127.0.0.1'),
        expect.stringContaining('1080')
      ]),
      'root'
    )
  })

  it('reports an actionable error when the in-container probe times out', async () => {
    const {proxy} = await buildProxyWithStopError(alreadyStoppedError())
    jest
      .spyOn(ContainerService, 'execCommand')
      .mockRejectedValue(new Error('Command exited with code 124'))

    await expect(proxy.waitUntilReady()).rejects.toThrow(
      'Proxy did not start accepting connections on port 1080 within 60 seconds'
    )
  })
})

describe('Proxy shutdown', () => {
  it('preserves a readiness error and removes resources when the proxy is already stopped', async () => {
    const {
      containerRemove,
      externalNetworkRemove,
      internalNetworkRemove,
      proxy
    } = await buildProxyWithStopError(alreadyStoppedError())
    const readinessError = new Error('proxy readiness timed out')
    proxy.waitUntilReady = jest.fn().mockRejectedValue(readinessError)
    const {updater, restoreProxyBuilder} = buildUpdaterWithProxy(proxy)

    try {
      await expect(updater.runUpdater()).rejects.toBe(readinessError)
      expect(containerRemove.mock.calls).toHaveLength(1)
      expect(externalNetworkRemove.mock.calls).toHaveLength(1)
      expect(internalNetworkRemove.mock.calls).toHaveLength(1)
    } finally {
      restoreProxyBuilder()
    }
  })

  it('preserves a readiness error when unexpected cleanup fails', async () => {
    const stopError = Object.assign(new Error('Docker API unavailable'), {
      statusCode: 500
    })
    const removeError = new Error('container removal failed')
    const {
      containerRemove,
      externalNetworkRemove,
      internalNetworkRemove,
      proxy
    } = await buildProxyWithStopError(stopError, removeError)
    const readinessError = new Error('proxy readiness timed out')
    proxy.waitUntilReady = jest.fn().mockRejectedValue(readinessError)
    const {updater, restoreProxyBuilder} = buildUpdaterWithProxy(proxy)
    const info = jest.spyOn(core, 'info').mockImplementation()

    try {
      await expect(updater.runUpdater()).rejects.toBe(readinessError)
      expect(containerRemove.mock.calls).toHaveLength(1)
      expect(externalNetworkRemove.mock.calls).toHaveLength(1)
      expect(internalNetworkRemove.mock.calls).toHaveLength(1)
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('Docker API unavailable')
      )
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('container removal failed')
      )
    } finally {
      info.mockRestore()
      restoreProxyBuilder()
    }
  })

  it('sequences cleanup and aggregates failures after attempting every step', async () => {
    const stopError = Object.assign(new Error('Docker API unavailable'), {
      statusCode: 500
    })
    const removeError = new Error('container removal failed')
    const {promise, reject} = Promise.withResolvers<void>()
    const containerRemove = jest.fn().mockReturnValue(promise)
    const {externalNetworkRemove, internalNetworkRemove, proxy} =
      await buildProxyWithStopError(stopError, undefined, containerRemove)

    const shutdown = proxy.shutdown()
    await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate))

    expect(externalNetworkRemove.mock.calls).toHaveLength(0)
    expect(internalNetworkRemove.mock.calls).toHaveLength(0)

    reject(removeError)
    await expect(shutdown).rejects.toEqual(
      new AggregateError([stopError, removeError], 'Failed to clean up proxy')
    )
    expect(containerRemove.mock.calls).toHaveLength(1)
    expect(externalNetworkRemove.mock.calls).toHaveLength(1)
    expect(internalNetworkRemove.mock.calls).toHaveLength(1)
  })
})
