import fs from 'fs'
import path from 'path'
import {Updater} from '../src/updater'
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
    getJobToken: jest.fn(),
    params: {
      jobId: 1,
      dependabotApiUrl: 'http://localhost:3001'
    },
    jobToken: 'job-token',
    credentialsToken: 'job-credentials-token'
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
    fs.rmSync(workingDirectory, {recursive: true})
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
      jest.spyOn(ContainerService, 'run').mockImplementationOnce(
        jest.fn(async () => {
          fs.copyFileSync(outputFixture, outputFilePath)
          return true
        })
      )
    })

    it('should be successful', async () => {
      expect(await updater.runUpdater()).toBe(true)
    })
  })

  describe('when the updater container fails', () => {
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
            Promise.reject(new Error('Call to container service errored'))
          )
        )
    })

    it('should raise an error', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(
        'Call to container service errored'
      )
    })
  })

  describe('when given credentials', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org',
          username: 'npm_user',
          token: 'npm_token',
          'replaces-base': true
        }
      ],
      workingDirectory
    )

    it('generates credentials metadata on the job definition', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org',
          'replaces-base': true
        }
      ])
    })
  })

  describe('when given duplicate credentials', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        }
      ],
      workingDirectory
    )

    it('removes duplicates from the metadata', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        }
      ])
    })
  })

  describe('when given a jit_access type credential', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'jit_access',
          host: 'github.com',
          token: 'hello'
        }
      ],
      workingDirectory
    )

    it('removes it from the metadata', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        }
      ])
    })
  })
})
