import Docker from 'dockerode'
import {Updater} from '../src/updater'

describe('Updater', () => {
  const docker = new Docker()
  const mockDependabotAPI: any = {
    getJobDetails: jest.fn()
  }
  const updater = new Updater(docker, mockDependabotAPI)

  it('should fetch job details', async () => {
    mockDependabotAPI.getJobDetails.mockImplementation(() => {
      throw new Error('kaboom')
    })
    updater.runUpdater()
  })
})
