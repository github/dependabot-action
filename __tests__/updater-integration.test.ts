import * as httpClient from '@actions/http-client'
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

  // Define jobToken and credentialsToken
  const jobToken = 'xxx'
  const credentialsToken = 'yyy'

  const params = new JobParameters(
    1,
    jobToken,
    credentialsToken,
    dependabotApiUrl,
    dependabotApiDockerUrl,
    updaterImage
  )

  const client = new httpClient.HttpClient(
    'github/dependabot-action integration'
  )
  const apiClient = new ApiClient(client, params, jobToken, credentialsToken)

  beforeAll(async () => {
    await ImageService.pull(updaterImageName('npm_and_yarn'))
    await ImageService.pull(PROXY_IMAGE_NAME)
  })

  afterEach(async () => {
    server && server() // eslint-disable-line @typescript-eslint/no-unused-expressions
    await removeDanglingUpdaterContainers()
  })

  jest.setTimeout(120000)
  it('should run the updater, retry on apiClient failure, and create a pull request', async () => {
    const testRetry = true
    server = await runFakeDependabotApi(FAKE_SERVER_PORT, testRetry)

    const details = await apiClient.getJobDetails()
    const credentials = await apiClient.getCredentials()

    const updater = new Updater(
      updaterImageName('npm_and_yarn'),
      PROXY_IMAGE_NAME,
      apiClient,
      details,
      credentials
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

  jest.setTimeout(120000)
  // Skipped until the updater image supports running the phases separately.
  // `bin/run fetch_files` is currently a no-op kept for backward compatibility
  // ("fetch_files command is no longer used directly"), and `bin/update_files.rb`
  // runs the file fetcher in-process and hands the files straight to
  // UpdateFilesCommand, so no output.json is produced for the handoff. The same
  // gap is why DEPENDABOT_SPLIT_FETCH_UPDATE is required alongside the
  // experiment; both this test and that opt-in can go once an image ships with
  // standalone phase entrypoints.
  it.skip('should create the same pull request when the phases are split', async () => {
    // Each test gets its own server, as afterEach tears the previous one down.
    server = await runFakeDependabotApi(FAKE_SERVER_PORT)
    process.env.DEPENDABOT_SPLIT_FETCH_UPDATE = '1'

    const details = await apiClient.getJobDetails()
    const credentials = await apiClient.getCredentials()

    const updater = new Updater(
      updaterImageName('npm_and_yarn'),
      PROXY_IMAGE_NAME,
      apiClient,
      {
        ...details,
        experiments: {
          ...details.experiments,
          'split-fetch-update-containers': true
        }
      },
      credentials
    )

    await updater.runUpdater()

    const res = await client.getJson<any>(`${dependabotApiUrl}/pull_requests/1`)

    expect(res.statusCode).toEqual(200)
    expect(res.result['pr-title']).toEqual(
      'Bump fetch-factory from 0.0.1 to 0.2.1'
    )
  })
})
