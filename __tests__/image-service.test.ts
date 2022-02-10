import {ImageService} from '../src/image-service'

describe('ImageService', () => {
  const originalEnv = process.env

  describe('when GITHUB_TOKEN is not set', () => {
    beforeEach(async () => {
      jest.resetModules()
      process.env = {
        ...originalEnv,
        GITHUB_TOKEN: undefined
      }
    })

    afterEach(async () => {
      process.env = originalEnv
    })

    test('it raises an error', async () => {
      await expect(
        ImageService.pull('ghcr.io/dependabot/dependabot-core:latest')
      ).rejects.toThrowError(
        new Error('No GITHUB_TOKEN set, unable to pull images.')
      )
    })
  })

  describe('when asked to fetch non-GitHub hosted images', () => {
    beforeEach(async () => {
      jest.resetModules()
      process.env = {
        ...originalEnv,
        GITHUB_TOKEN: 'mock_token'
      }
    })

    afterEach(async () => {
      process.env = originalEnv
    })

    test('it raises an error', async () => {
      await expect(ImageService.pull('hello-world')).rejects.toThrowError(
        new Error(
          'Only images distributed via docker.pkg.github.com or ghcr.io can be fetched'
        )
      )
    })
  })
})
