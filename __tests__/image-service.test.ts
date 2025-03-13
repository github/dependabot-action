import * as core from '@actions/core'
import Docker from 'dockerode'
import {Readable} from 'stream'
import {ImageService, MetricReporter} from '../src/image-service'

jest.mock('@actions/core')

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

describe('ImageService.fetchImageWithRetry', () => {
  let pullMock: jest.Mock
  let docker: Docker
  let modemMock: any
  let getImageMock: jest.Mock

  const MAX_RETRIES = 5
  const sendMetricsMock: MetricReporter = jest.fn(async () => Promise.resolve())

  beforeEach(() => {
    pullMock = jest.fn().mockResolvedValue(
      new Readable({
        read() {} // Empty read function to avoid stream errors
      })
    )

    getImageMock = jest.fn().mockImplementation(() => ({
      inspect: jest.fn().mockResolvedValue({
        RepoDigests: ['ghcr.io/dependabot/dependabot-updater-npm:latest']
      }),
      remove: jest.fn(),
      history: jest.fn(),
      get: jest.fn(),
      tag: jest.fn()
    }))

    modemMock = {
      followProgress: jest.fn((stream, onFinished) => onFinished(null))
    }

    docker = new Docker()
    jest.spyOn(docker, 'pull').mockImplementation(pullMock)
    jest.spyOn(docker, 'getImage').mockImplementation(getImageMock)

    // Mock modem property to avoid `followProgress` errors
    Object.defineProperty(docker, 'modem', {value: modemMock})

    jest.spyOn(global, 'setTimeout').mockImplementation(fn => {
      fn()
      return {} as NodeJS.Timeout
    })

    jest.spyOn(core, 'info').mockImplementation(jest.fn())
    jest.spyOn(core, 'warning').mockImplementation(jest.fn())
    jest.spyOn(core, 'error').mockImplementation(jest.fn())
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('it retries with jitter on 429 Too Many Requests', async () => {
    pullMock
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce(
        new Readable({
          read() {}
        })
      ) // Succeeds on the third attempt

    await expect(
      ImageService.fetchImageWithRetry(
        'ghcr.io/dependabot/dependabot-updater-npm',
        {},
        docker,
        sendMetricsMock,
        'dependabot'
      )
    ).resolves.not.toThrow()

    expect(pullMock).toHaveBeenCalledTimes(3)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Retrying in')
    )
  })

  test('it fails after MAX_RETRIES on persistent 429 errors', async () => {
    pullMock.mockRejectedValue(new Error('429 Too Many Requests')) // Always fails

    await expect(
      ImageService.fetchImageWithRetry(
        'ghcr.io/dependabot/dependabot-updater-npm',
        {},
        docker,
        sendMetricsMock,
        'dependabot'
      )
    ).rejects.toThrow('429 Too Many Requests')

    expect(pullMock).toHaveBeenCalledTimes(MAX_RETRIES)
  })

  test('it does not retry on fatal errors', async () => {
    pullMock.mockRejectedValue(new Error('500 Internal Server Error')) // Fatal error

    await expect(
      ImageService.fetchImageWithRetry(
        'ghcr.io/dependabot/dependabot-updater-npm',
        {},
        docker,
        sendMetricsMock,
        'dependabot'
      )
    ).rejects.toThrow('500 Internal Server Error')

    expect(pullMock).toHaveBeenCalledTimes(1) // No retries should occur
  })
})
