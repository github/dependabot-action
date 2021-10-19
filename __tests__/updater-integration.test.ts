import axios from 'axios'
import fs from 'fs'
import path from 'path'
import {ApiClient} from '../src/api-client'
import {ImageService} from '../src/image-service'
import {JobParameters} from '../src/inputs'
import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from '../src/main'
import {Updater} from '../src/updater'

import {removeDanglingUpdaterContainers, runFakeDependabotApi} from './helpers'

const FAKE_SERVER_PORT = 9000

describe('Updater', () => {
  let server: any

  // Used from this action to get job details and credentials
  const dependabotApiUrl = `http://localhost:${FAKE_SERVER_PORT}`
  // Used from within the updater container to update the job state and create prs
  const internalDockerHost =
    process.platform === 'darwin' ? 'host.docker.internal' : '172.17.0.1'
  const dependabotApiDockerUrl = `http://${internalDockerHost}:${FAKE_SERVER_PORT}`
  const workingDirectory = path.join(
    __dirname,
    '..',
    'tmp',
    './integration_working_directory'
  )

  const params = new JobParameters(
    1,
    'job-token',
    'cred-token',
    dependabotApiUrl,
    dependabotApiDockerUrl,
    workingDirectory
  )

  const client = axios.create({baseURL: dependabotApiUrl})
  const apiClient = new ApiClient(client, params)

  beforeAll(async () => {
    // Skip the test when we haven't preloaded the updater image
    if (process.env.SKIP_INTEGRATION_TESTS) {
      return
    }

    await ImageService.pull(UPDATER_IMAGE_NAME)
    await ImageService.pull(PROXY_IMAGE_NAME)

    server = await runFakeDependabotApi(FAKE_SERVER_PORT)

    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    server && server() // teardown server process
    await removeDanglingUpdaterContainers()
    fs.rmdirSync(workingDirectory, {recursive: true})
  })

  jest.setTimeout(120000)
  it('should run the updater and create a pull request', async () => {
    // Skip the test when we haven't preloaded the updater image
    if (process.env.SKIP_INTEGRATION_TESTS) {
      return
    }

    const details = await apiClient.getJobDetails()
    const credentials = await apiClient.getCredentials()

    const updater = new Updater(
      UPDATER_IMAGE_NAME,
      PROXY_IMAGE_NAME,
      apiClient,
      details,
      credentials,
      workingDirectory
    )

    await updater.runUpdater()

    // NOTE: This will not work when running against the actual dependabot-api
    // Checks if the pr was persisted in the fake json-server
    const res: any = await client.get('/pull_requests/1')

    expect(res.status).toEqual(200)
    expect(res.data['pr-title']).toEqual(
      'Bump fetch-factory from 0.0.1 to 0.2.1'
    )
  })
})
