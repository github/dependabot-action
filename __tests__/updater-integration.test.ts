import * as httpClient from '@actions/http-client'
import fs from 'fs'
import path from 'path'
import {ApiClient} from '../src/api-client'
import {ImageService} from '../src/image-service'
import {JobParameters} from '../src/inputs'
import {updaterImageName, PROXY_IMAGE_NAME} from '../src/docker-tags'
import {Updater} from '../src/updater'

import {
  integration,
  removeDanglingUpdaterContainers,
  runFakeDependabotApi
} from './helpers'

const FAKE_SERVER_PORT = 9000

integration('Updater', () => {
  let server: any

  // Used from this action to get job details and credentials
  const dependabotApiUrl = `http://localhost:${FAKE_SERVER_PORT}`
  // Used from within the updater container to update the job state and create prs
  const internalDockerHost =
    process.platform === 'darwin' ? 'host.docker.internal' : '172.17.0.1'
  const dependabotApiDockerUrl = `http://${internalDockerHost}:${FAKE_SERVER_PORT}`
  const updaterImage = updaterImageName('npm_and_yarn')
  const workingDirectory = path.join(
    __dirname,
    '..',
    'tmp',
    './integration_working_directory'
  )

  // Define jobToken and credentialsToken
  const jobToken = 'xxx'
  const credentialsToken = 'yyy'

  const params = new JobParameters(
    1,
    jobToken,
    credentialsToken,
    dependabotApiUrl,
    dependabotApiDockerUrl,
    updaterImage,
    workingDirectory
  )

  const client = new httpClient.HttpClient(
    'github/dependabot-action integration'
  )
  const apiClient = new ApiClient(client, params, jobToken, credentialsToken)

  beforeAll(async () => {
    await ImageService.pull(updaterImageName('npm_and_yarn'))
    await ImageService.pull(PROXY_IMAGE_NAME)

    const testRetry = true
    server = await runFakeDependabotApi(FAKE_SERVER_PORT, testRetry)

    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    server && server() // teardown server process
    await removeDanglingUpdaterContainers()
    fs.rmSync(workingDirectory, {recursive: true})
  })

  jest.setTimeout(120000)
  it('should run the updater, retry on apiClient failure, and create a pull request', async () => {
    const details = await apiClient.getJobDetails()
    const credentials = await apiClient.getCredentials()

    const updater = new Updater(
      updaterImageName('npm_and_yarn'),
      PROXY_IMAGE_NAME,
      apiClient,
      details,
      credentials,
      workingDirectory
    )

    await updater.runUpdater()

    // NOTE: This will not work when running against the actual dependabot-api
    // Checks if the pr was persisted in the fake json-server
    const res = await client.getJson<any>(`${dependabotApiUrl}/pull_requests/1`)

    expect(res.statusCode).toEqual(200)
    expect(res.result['pr-title']).toEqual(
      'Bump fetch-factory from 0.0.1 to 0.2.1'
    )
  })
})
