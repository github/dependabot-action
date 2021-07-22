import Docker from 'dockerode'
import fs from 'fs'
import path from 'path'
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
      dependabotAPI: 'http://host.docker.internal:3001'
    }
  }
  const updater = new Updater(docker, mockDependabotAPI)

  beforeAll(() => {
    updater.pullImage()
  })

  afterEach(() => {
    docker.listContainers(function (err, containers) {
      if (!containers) return

      containers.forEach(function (containerInfo) {
        if (
          containerInfo.Image.includes(
            'docker.pkg.github.com/dependabot/dependabot-updater'
          )
        ) {
          console.log('removing')

          docker.getContainer(containerInfo.Id).remove()
        }
      })
    })
  })

  jest.setTimeout(20000)
  it('should fetch manifests', async () => {
    mockDependabotAPI.getJobDetails.mockImplementation(() => {
      return JSON.parse(
        fs
          .readFileSync(path.join(__dirname, 'fixtures/job-details/npm.json'))
          .toString()
      ).data.attributes
    })
    mockDependabotAPI.getCredentials.mockImplementation(() => {
      return [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'x-access-token',
          password: process.env.GITHUB_TOKEN
        }
      ]
    })
    await updater.runUpdater()
  })
})
