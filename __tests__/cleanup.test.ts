import * as core from '@actions/core'
import Docker from 'dockerode'
import {
  PROXY_IMAGE_NAME,
  repositoryName,
  updaterImages
} from '../src/docker-tags'

const mockPruneNetworks = jest.fn()
const mockPruneContainers = jest.fn()
const mockListImages = jest.fn()
const mockGetImage = jest.fn()

jest.mock('@actions/core', () => ({
  error: jest.fn(),
  info: jest.fn(),
  setFailed: jest.fn()
}))
jest.mock('dockerode', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    pruneNetworks: mockPruneNetworks,
    pruneContainers: mockPruneContainers,
    listImages: mockListImages,
    getImage: mockGetImage
  }))
}))

let run: typeof import('../src/cleanup').run
let cleanupOldImageVersions: typeof import('../src/cleanup').cleanupOldImageVersions

beforeAll(async () => {
  process.env.DEPENDABOT_DISABLE_CLEANUP = '1'
  const cleanup = await import('../src/cleanup')
  run = cleanup.run
  cleanupOldImageVersions = cleanup.cleanupOldImageVersions
  delete process.env.DEPENDABOT_DISABLE_CLEANUP
})

const allImages = [...updaterImages(), PROXY_IMAGE_NAME]
const proxyRepository = repositoryName(PROXY_IMAGE_NAME)

describe('run', () => {
  beforeEach(() => {
    delete process.env.DEPENDABOT_DISABLE_CLEANUP
    mockPruneNetworks.mockReset().mockResolvedValue(undefined)
    mockPruneContainers.mockReset().mockResolvedValue(undefined)
    mockListImages.mockReset().mockResolvedValue([])
    mockGetImage.mockReset()
  })

  test('continues cleanup after network pruning fails', async () => {
    mockPruneNetworks.mockRejectedValueOnce(new Error('network prune failed'))

    await run()

    expect(core.error).toHaveBeenCalledWith(
      'Error pruning networks: network prune failed'
    )
    expect(mockPruneContainers).toHaveBeenCalledTimes(1)
    expect(mockListImages).toHaveBeenCalledTimes(allImages.length)
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  test('continues image cleanup after container pruning fails', async () => {
    mockPruneContainers.mockRejectedValueOnce(
      new Error('container prune failed')
    )

    await run()

    expect(mockListImages).toHaveBeenCalledTimes(allImages.length)
    expect(core.error).toHaveBeenCalledWith(
      'Error pruning containers: container prune failed'
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  test('reports one listing failure and cleans the other repositories', async () => {
    const failedRepository = repositoryName(allImages[0])
    mockListImages.mockImplementation(
      async (options: {filters: string}): Promise<Docker.ImageInfo[]> => {
        if (options.filters.includes(`"${failedRepository}"`)) {
          throw new Error('image listing failed')
        }
        return []
      }
    )

    await run()

    expect(mockListImages).toHaveBeenCalledTimes(allImages.length)
    expect(mockListImages).toHaveBeenCalledWith({
      filters: `{"reference":["${proxyRepository}"]}`
    })
    expect(core.error).toHaveBeenCalledWith(
      `Error cleaning up images for ${failedRepository}: image listing failed`
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  test('waits for every image repository cleanup to settle', async () => {
    let finishProxyListing: (() => void) | undefined
    const proxyListing = new Promise<Docker.ImageInfo[]>(resolve => {
      finishProxyListing = () => resolve([])
    })
    let markProxyStarted: (() => void) | undefined
    const proxyStarted = new Promise<void>(resolve => {
      markProxyStarted = resolve
    })

    mockListImages.mockImplementation(
      async (options: {filters: string}): Promise<Docker.ImageInfo[]> => {
        if (options.filters.includes(`"${proxyRepository}"`)) {
          markProxyStarted?.()
          return proxyListing
        }
        return []
      }
    )

    const cleanup = run()
    await proxyStarted

    expect(
      await Promise.race([cleanup, Promise.resolve('cleanup pending')])
    ).toBe('cleanup pending')

    finishProxyListing?.()
    await cleanup

    expect(mockListImages).toHaveBeenCalledTimes(allImages.length)
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})

describe('cleanupOldImageVersions', () => {
  beforeEach(() => {
    mockListImages.mockReset()
    mockGetImage.mockReset()
  })

  test('waits for image removal to complete', async () => {
    const docker = new Docker()
    const oldImage = {
      Id: 'old-image',
      RepoDigests: ['ghcr.io/dependabot/proxy@sha256:old']
    } as Docker.ImageInfo
    let finishRemoval: (() => void) | undefined
    const removal = new Promise<void>(resolve => {
      finishRemoval = resolve
    })
    const remove = jest.fn().mockReturnValue(removal)

    mockListImages.mockResolvedValue([oldImage])
    mockGetImage.mockReturnValue({remove})

    const cleanup = cleanupOldImageVersions(docker, PROXY_IMAGE_NAME)

    await Promise.resolve()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(
      await Promise.race([cleanup, Promise.resolve('removal pending')])
    ).toBe('removal pending')

    finishRemoval?.()
    await cleanup
  })

  test('reports image removal failures as informational', async () => {
    const docker = new Docker()
    const oldImage = {
      Id: 'old-image',
      RepoDigests: ['ghcr.io/dependabot/proxy@sha256:old']
    } as Docker.ImageInfo
    const remove = jest.fn().mockRejectedValue(new Error('image in use'))

    mockListImages.mockResolvedValue([oldImage])
    mockGetImage.mockReturnValue({remove})

    await cleanupOldImageVersions(docker, PROXY_IMAGE_NAME)

    expect(core.info).toHaveBeenCalledWith(
      'Unable to remove old-image -- image in use'
    )
    expect(core.error).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
