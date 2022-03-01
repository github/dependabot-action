import * as core from '@actions/core'
import Docker from 'dockerode'
import {ImageService} from '../src/image-service'
import {integration, delay} from './helpers'
import {run, cleanupOldImageVersions} from '../src/cleanup'

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
  // We use this GitHub-hosted hello world example as a small stand-in for this test
  // in order to avoid hitting the rate limit on pulling containers from docker.io
  // since this test needs to remove and pull containers per run.
  const testImage = 'ghcr.io/github/hello-docker'
  const docker = new Docker()
  const imageOptions = {
    filters: {
      reference: [testImage]
    }
  }

  const currentImage = `${testImage}@sha256:f32f4412fa4b6c7ece72cb85ae652751f11ac0d075c1131df09bb24f46b2f4e3`
  const oldImage = `${testImage}@sha256:8cfee63309567569d3d7d0edc05fcf8be8f9f5130f0564dacea4cfe82a9db4b7`

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
    await ImageService.fetchImage(currentImage)
    await ImageService.fetchImage(oldImage)
  }, 20000)

  afterEach(async () => {
    await clearTestImages()
  }, 10000)

  test('it removes unused versions of the given image', async () => {
    const imageCount = (await docker.listImages(imageOptions)).length
    expect(imageCount).toEqual(2)

    await cleanupOldImageVersions(docker, currentImage)
    // The Docker API seems to ack the removal before it is carried out, so let's wait briefly to ensure
    // the verification query doesn't race the deletion
    await delay(200)

    const remainingImages = await docker.listImages(imageOptions)
    expect(remainingImages.length).toEqual(1)
    expect(remainingImages[0].RepoDigests?.includes(currentImage))
  })
})
