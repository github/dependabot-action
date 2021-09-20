import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from '../src/main'
import {Updater} from '../src/updater'

describe('Updater', () => {
  const mockApiClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobId: 1,
      jobToken: process.env.JOB_TOKEN,
      credentialsToken: process.env.CREDENTIALS_TOKEN,
      dependabotApiUrl: 'http://host.docker.internal:3001'
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

  const updater = new Updater(
    UPDATER_IMAGE_NAME,
    PROXY_IMAGE_NAME,
    mockApiClient,
    mockJobDetails,
    []
  )

  it('should fetch job details', async () => {
    mockApiClient.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
