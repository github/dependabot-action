import {UpdaterBuilder} from '../src/updater-builder'
import {extractUpdaterSha} from '../src/utils'
import Docker from 'dockerode'
import {JobParameters} from '../src/inputs'

// Mock the extractUpdaterSha function to test the logic
jest.mock('../src/utils', () => ({
  extractUpdaterSha: jest.fn()
}))

// Mock the ContainerService
jest.mock('../src/container-service', () => ({
  ContainerService: {
    storeCert: jest.fn().mockResolvedValue(undefined),
    storeInput: jest.fn().mockResolvedValue(undefined)
  }
}))

const mockExtractUpdaterSha = extractUpdaterSha as jest.MockedFunction<
  typeof extractUpdaterSha
>

describe('UpdaterBuilder', () => {
  let mockDocker: Docker
  let mockCreateContainer: jest.Mock
  let mockContainer: any
  let mockProxy: any
  let jobParams: JobParameters
  let input: any

  beforeEach(() => {
    // Mock Docker container creation
    mockContainer = {
      id: 'test-container-id'
    }

    mockCreateContainer = jest.fn().mockResolvedValue(mockContainer)
    mockDocker = {
      createContainer: mockCreateContainer
    } as any

    // Mock proxy
    mockProxy = {
      url: jest.fn().mockResolvedValue('http://proxy:1080'),
      networkName: 'test-network',
      cert: 'test-cert'
    }

    // Mock job parameters
    jobParams = new JobParameters(
      1,
      'job-token',
      'cred-token',
      'https://example.com',
      '172.17.0.1',
      'test-image'
    )

    // Mock input
    input = {job: {id: 1}}
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should add DEPENDABOT_UPDATER_SHA to environment when SHA is present', async () => {
    const testSha = '04aab0a156d33033b6082c7deb5feb6a212e4174'
    const imageWithSha = `ghcr.io/dependabot/dependabot-updater-gomod:${testSha}`

    mockExtractUpdaterSha.mockReturnValue(testSha)

    const updaterBuilder = new UpdaterBuilder(
      mockDocker,
      jobParams,
      input,
      mockProxy,
      imageWithSha
    )

    await updaterBuilder.run('test-container')

    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining([`DEPENDABOT_UPDATER_SHA=${testSha}`])
      })
    )
  })

  it('should not add DEPENDABOT_UPDATER_SHA to environment when SHA is not present', async () => {
    const imageWithoutSha = 'ghcr.io/dependabot/dependabot-updater-gomod'

    mockExtractUpdaterSha.mockReturnValue(null)

    const updaterBuilder = new UpdaterBuilder(
      mockDocker,
      jobParams,
      input,
      mockProxy,
      imageWithoutSha
    )

    await updaterBuilder.run('test-container')

    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.not.arrayContaining([
          expect.stringMatching(/DEPENDABOT_UPDATER_SHA=/)
        ])
      })
    )
  })
})
