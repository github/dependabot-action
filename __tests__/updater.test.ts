import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from '../src/main'
import {Updater} from '../src/updater'
import {PackageManager} from '../src/api-client'

describe('Updater', () => {
  const mockAPIClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobID: 1,
      jobToken: process.env.JOB_TOKEN,
      credentialsToken: process.env.CREDENTIALS_TOKEN,
      dependabotAPIURL: 'http://host.docker.internal:3001'
    }
  }
  const mockJobDetails: any = {
    id: '1',
    'allowed-updates': [
      {
        'dependency-type': 'all'
      }
    ],
    'package-manage': PackageManager.NpmAndYarn
  }

  const updater = new Updater(
    UPDATER_IMAGE_NAME,
    PROXY_IMAGE_NAME,
    mockAPIClient,
    mockJobDetails,
    []
  )

  it('should fetch job details', async () => {
    mockAPIClient.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
