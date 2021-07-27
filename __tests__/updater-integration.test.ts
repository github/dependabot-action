import path from 'path'
import axios from 'axios'
import waitPort from 'wait-port'
import {spawn} from 'child_process'

import {Updater} from '../src/updater'
import {UPDATER_IMAGE_NAME} from '../src/main'
import {APIClient, JobParameters} from '../src/api-client'
import {ImageService} from '../src/image-service'

import {removeDanglingUpdaterContainers} from './helpers'
const FAKE_SERVER_PORT = 9000

describe('Updater', () => {
  let server: any

  // To run the js-code itself against API:
  // const params = {
  //   jobID: 1,
  //   jobToken: 'xxx',
  //   credentialsToken: 'xxx',
  //   dependabotAPI: 'http://host.docker.internal:3001'
  // }

  // This runs the tests against a fake dependabot-api server using json-server
  const fakeDependabotApiUrl = `http://host.docker.internal:${FAKE_SERVER_PORT}`
  const dependabotApiUrl =
    process.env.DEPENDABOT_API_URL || fakeDependabotApiUrl
  const params = new JobParameters(
    1,
    process.env.JOB_TOKEN || 'job-token',
    process.env.CREDENTIALS_TOKEN || 'cred-token',
    process.env.DEPENDABOT_API_URL ||
      `http://host.docker.internal:${FAKE_SERVER_PORT}`
  )

  const client = axios.create({baseURL: params.dependabotAPIURL})
  const apiClient = new APIClient(client, params)
  const updater = new Updater(UPDATER_IMAGE_NAME, apiClient)

  beforeAll(async () => {
    if (process.env.SKIP_INTEGRATION_TESTS) {
      // Skip this test on CI, as it takes too long to download the image
      return
    }

    await ImageService.pull(UPDATER_IMAGE_NAME)

    if (dependabotApiUrl === fakeDependabotApiUrl) {
      server = spawn(`${path.join(__dirname, 'server/server.js')}`)
      server.stdout.on('data', (data: any) => {
        console.log(`json-server log: ${data}`) // eslint-disable-line no-console
      })
      server.stderr.on('data', (data: any) => {
        console.error(`json-server error: ${data}`) // eslint-disable-line no-console
      })
      await waitPort({port: FAKE_SERVER_PORT})
    }
  })

  afterEach(async () => {
    server && server.kill()
    await removeDanglingUpdaterContainers()
  })

  jest.setTimeout(30000)
  it('should fetch manifests', async () => {
    if (process.env.SKIP_INTEGRATION_TESTS) {
      // Skip this test on CI, as it takes too long to download the image
      return
    }

    await updater.runUpdater()

    // TODO: Check if the pr was persisted in json-server
    // const res = await client.get('/pull_requests/1')
    // expect(res.status).toEqual(200)
  })
})
