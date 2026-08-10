import Docker from 'dockerode'
import {cleanupOldImageVersions} from '../src/cleanup'
import {PROXY_IMAGE_NAME} from '../src/docker-tags'

jest.mock('@actions/core')
jest.mock('dockerode', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    pruneNetworks: jest.fn().mockResolvedValue(undefined),
    pruneContainers: jest.fn().mockResolvedValue(undefined),
    listImages: jest.fn().mockResolvedValue([]),
    getImage: jest.fn()
  }))
}))

describe('cleanupOldImageVersions', () => {
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

    jest.spyOn(docker, 'listImages').mockResolvedValue([oldImage])
    jest
      .spyOn(docker, 'getImage')
      .mockReturnValue({remove} as unknown as Docker.Image)

    const cleanup = cleanupOldImageVersions(docker, PROXY_IMAGE_NAME)

    await Promise.resolve()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(
      await Promise.race([cleanup, Promise.resolve('removal pending')])
    ).toBe('removal pending')

    finishRemoval?.()
    await cleanup
  })
})
