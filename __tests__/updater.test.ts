import Docker from 'dockerode'
import {Updater} from '../src/updater'

describe('Updater', () => {
  const docker = new Docker()
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
  const updater = new Updater(docker, mockAPIClient)

  it('should fetch job details', async () => {
    mockAPIClient.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
