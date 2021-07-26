import {UPDATER_IMAGE_NAME} from '../src/main'
import {Updater} from '../src/updater'

describe('Updater', () => {
  const mockAPIClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobID: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy',
      dependabotAPIURL: 'http://localhost'
    }
  }
  const updater = new Updater(UPDATER_IMAGE_NAME, mockAPIClient)

  it('should fetch job details', async () => {
    mockAPIClient.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
