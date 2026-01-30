import * as core from '@actions/core'
import Docker from 'dockerode'
import {ImageService} from '../src/image-service'
import {integration, delay} from './helpers'
import {run, cleanupOldImageVersions} from '../src/cleanup'
import {PROXY_IMAGE_NAME, digestName} from '../src/docker-tags'

integration('run', () => {
  beforeEach(async () => {
    jest.spyOn(core, 'error').mockImplementation(jest.fn())
  })

  test('it does not log any errors interacting with Docker by default', async () => {
    await run()

    expect(core.error).not.toHaveBeenCalled()
  })
})

integration('cleanupOldImageVersions', () => {
  const docker = new Docker()
  const imageOptions = {
    filters: `{"reference":["ghcr.io/dependabot/proxy"]}`
  }

  const currentImage = PROXY_IMAGE_NAME
  const oldImage = `ghcr.io/dependabot/proxy:v2.0.20250520183158@sha256:e98873d74eeb64dc5075d8044cfa4242981ae7ad05e06b17708a3f13719a74f6`

  async function clearTestImages(): Promise<void> {
    const testImages = await docker.listImages(imageOptions)

    for (const image of testImages) {
      await docker.getImage(image.Id).remove()
    }
  }

  beforeAll(async () => {
    // Remove any existing alpine images from other tests
    await clearTestImages()
  }, 10000)

  beforeEach(async () => {
    await ImageService.fetchImageWithRetry(
      currentImage,
      {},
      docker,
      undefined,
      'dependabot'
    )
    await ImageService.fetchImageWithRetry(
      oldImage,
      {},
      docker,
      undefined,
      'dependabot'
    )
  }, 20000)

  afterEach(async () => {
    await clearTestImages()
  }, 10000)

  test('it removes unused versions of the given image', async () => {
    const initialImages = await docker.listImages(imageOptions)
    expect(initialImages.length).toEqual(2)

    await cleanupOldImageVersions(docker, currentImage)
    // The Docker API seems to ack the removal before it is carried out, so let's wait briefly to ensure
    // the verification query doesn't race the deletion
    await delay(200)

    const remainingImages = await docker.listImages(imageOptions)
    expect(remainingImages.length).toEqual(1)
    expect(
      remainingImages[0].RepoDigests?.includes(digestName(currentImage))
    ).toEqual(true)
  })

  test('it no-ops when disabled', async () => {
    process.env.DEPENDABOT_DISABLE_CLEANUP = '1'

    const imageCount = (await docker.listImages(imageOptions)).length
    expect(imageCount).toEqual(2)

    await run()
    // The Docker API seems to ack the removal before it is carried out, so let's wait briefly to ensure
    // the verification query doesn't race the deletion
    await delay(200)

    const remainingImages = await docker.listImages(imageOptions)
    expect(remainingImages.length).toEqual(2)
  })
})
