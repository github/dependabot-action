import {ImageService} from '../src/image-service'

describe('ImageService', () => {
  describe('when asked to fetch non-GitHub hosted images', () => {
    test('it raises an error', async () => {
      await expect(ImageService.pull('hello-world')).rejects.toThrowError(
        new Error(
          'Only images distributed via docker.pkg.github.com or ghcr.io can be fetched'
        )
      )
    })
  })
})
