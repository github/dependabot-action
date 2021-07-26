import Docker from 'dockerode'
import fs from 'fs'
import path from 'path'
import {Updater} from '../src/updater'
import {UPDATER_IMAGE_NAME} from '../src/main'
import {ImageService} from '../src/image-service'

describe('Updater', () => {
  // To run the js-code itself against API:
  // const params = {
  //   jobID: 1,
  //   jobToken: 'xxx',
  //   credentialsToken: 'xxx',
  //   dependabotAPI: 'http://host.docker.internal:3001'
  // }
  // const client = axios.create({baseURL: params.dependabotAPI})
  // const api = new DependabotAPI(client, params)
  // const updater = new Updater(UPDATER_IMAGE_NAME, api)

  // This stubs out API calls from JS, but will run the updater against an API
  // running on the specified API endpoint.
  const mockAPIClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    params: {
      jobID: 1,
      jobToken: 'xxx',
      credentialsToken: 'yyy',
      dependabotAPIURL: 'http://host.docker.internal:3001'
    }
  }
  const updater = new Updater(UPDATER_IMAGE_NAME, mockAPIClient)

  beforeAll(async () => {
    if (process.env.CI) {
      // Skip this test on CI, as it takes too long to download the image
      return
    }
    await ImageService.pullImage(UPDATER_IMAGE_NAME)
  })

  afterEach(async () => {
    const docker = new Docker()
    const containers = (await docker.listContainers()) || []

    for (const container of containers) {
      if (
        container.Image.includes(
          'docker.pkg.github.com/dependabot/dependabot-updater'
        )
      ) {
        try {
          await docker.getContainer(container.Id).remove({v: true, force: true})
        } catch (e) {
          // ignore
        }
      }
    }
  })

  jest.setTimeout(20000)
  it('should fetch manifests', async () => {
    if (process.env.CI) {
      // Skip this test on CI, as it takes too long to download the image
      return
    }

    mockAPIClient.getJobDetails.mockImplementation(() => {
      return JSON.parse(
        fs
          .readFileSync(path.join(__dirname, 'fixtures/job-details/npm.json'))
          .toString()
      ).data.attributes
    })
    mockAPIClient.getCredentials.mockImplementation(() => {
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
