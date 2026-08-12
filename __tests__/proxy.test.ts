import Docker, {Container, Network} from 'dockerode'
import {PassThrough} from 'node:stream'
import {ContainerService} from '../src/container-service'
import {Proxy, ProxyBuilder} from '../src/proxy'

type ProxyTestResources = {
  container: Container
  proxy: Proxy
}

async function buildProxy(): Promise<ProxyTestResources> {
  const container = {
    id: 'proxy-container',
    attach: jest.fn().mockResolvedValue(new PassThrough()),
    modem: {demuxStream: jest.fn()},
    putArchive: jest.fn().mockResolvedValue(undefined),
    inspect: jest
      .fn()
      .mockRejectedValue(new Error('host cannot reach the internal IP')),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined)
  } as unknown as Container
  const externalNetwork = {
    connect: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined)
  } as unknown as Network
  const internalNetwork = {
    remove: jest.fn().mockResolvedValue(undefined)
  } as unknown as Network
  const docker = {
    listNetworks: jest.fn().mockResolvedValue([]),
    createNetwork: jest
      .fn()
      .mockResolvedValueOnce(externalNetwork)
      .mockResolvedValueOnce(internalNetwork),
    createContainer: jest.fn().mockResolvedValue(container)
  } as unknown as Docker
  const proxy = await new ProxyBuilder(docker, 'proxy-image', false).run(
    1,
    'job-token',
    'https://dependabot-api.example.com',
    []
  )

  return {
    container,
    proxy
  }
}

describe('Proxy readiness', () => {
  it('checks readiness inside the proxy container network namespace', async () => {
    const {container, proxy} = await buildProxy()
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
    const {proxy} = await buildProxy()
    jest
      .spyOn(ContainerService, 'execCommand')
      .mockRejectedValue(new Error('Command exited with code 124'))

    await expect(proxy.waitUntilReady()).rejects.toThrow(
      'Proxy did not start accepting connections on port 1080 within 60 seconds'
    )
  })
})
