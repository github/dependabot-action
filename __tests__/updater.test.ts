import fs from 'fs'
import path from 'path'
import {Updater, UpdaterFetchError} from '../src/updater'
import Docker from 'dockerode'
import {ContainerService} from '../src/container-service'
import {ProxyBuilder} from '../src/proxy'

// We do not need to build actual containers or run updates for this test.)
jest.mock('dockerode')
jest.mock('../src/container-service')
jest.mock('../src/proxy')

const outputFixturePath = (fixtureName: string): string => {
  return path.join(
    __dirname,
    '..',
    '__fixtures__',
    'output',
    fixtureName,
    'output.json'
  )
}

describe('Updater', () => {
  const mockApiClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobId: 1,
      jobToken: 'job-token',
      credentialsToken: 'job-credentials-token',
      dependabotApiUrl: 'http://localhost:3001'
    }
  }

  const mockJobDetails: any = {
    id: '1',
    'allowed-updates': [
      {
        'dependency-type': 'all'
      }
    ],
    'package-manager': 'npm-and-yarn'
  }

  const mockProxy: any = {
    container: {
      start: jest.fn()
    },
    network: jest.fn(),
    networkName: 'mockNetworkName',
    url: () => {
      'http://localhost'
    },
    cert: 'mockCertificate',
    shutdown: jest.fn()
  }

  const mockContainer: any = {
    id: 1
  }

  const workingDirectory = path.join(
    __dirname,
    '..',
    'tmp',
    './test_working_directory'
  )

  const outputFilePath = path.join(workingDirectory, 'output', 'output.json')

  beforeEach(async () => {
    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
    fs.rmdirSync(workingDirectory, {recursive: true})
  })

  describe('when there is a happy path update', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      [],
      workingDirectory
    )

    const outputFixture = outputFixturePath('happy_path')

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)
      jest
        .spyOn(ContainerService, 'run')
        .mockImplementationOnce(
          jest.fn(async () => {
            fs.copyFileSync(outputFixture, outputFilePath)
            return true
          })
        )
        .mockImplementationOnce(
          jest.fn(
            jest.fn(async () => {
              return true
            })
          )
        )
    })

    it('should be successful', async () => {
      expect(await updater.runUpdater()).toBe(true)
    })
  })

  describe('when the file fetch container fails', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      [],
      workingDirectory
    )

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)

      jest
        .spyOn(ContainerService, 'run')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('First call to container service errored'))
          )
        )
    })

    it('should raise an error', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(
        'First call to container service errored'
      )
    })
  })

  describe('when file updater container fails', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      [],
      workingDirectory
    )

    const outputFixture = outputFixturePath('happy_path')

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)

      jest
        .spyOn(ContainerService, 'run')
        .mockImplementationOnce(
          jest.fn(async () => {
            fs.copyFileSync(outputFixture, outputFilePath)
            return true
          })
        )
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(
              new Error('Second call to container service errored')
            )
          )
        )
    })

    it('should raise an error', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(
        'Second call to container service errored'
      )
    })
  })

  describe('when the file fetch step results in empty output', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      [],
      workingDirectory
    )

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)

      jest.spyOn(ContainerService, 'run').mockImplementation(jest.fn())
    })

    it('should raise a UpdaterFetchError', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(
        new UpdaterFetchError('No output.json created by the fetcher container')
      )
    })
  })

  describe('when the file fetch step results in malformed output', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      [],
      workingDirectory
    )

    const outputFixture = outputFixturePath('malformed')

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)

      jest.spyOn(ContainerService, 'run').mockImplementation(
        jest.fn(async () => {
          fs.copyFileSync(outputFixture, outputFilePath)
          return true
        })
      )
    })

    it('should raise an error', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(/Unexpected token/)
    })
  })
})
