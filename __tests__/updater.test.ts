import Docker from 'dockerode'
import {Updater} from '../src/updater'

describe('Updater', () => {
  const docker = new Docker()
  const mockDependabotAPI: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobID: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy',
      dependabotAPI: 'http://localhost'
    }
  }
  const updater = new Updater(docker, mockDependabotAPI)

  it('should fetch job details', async () => {
    mockDependabotAPI.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
