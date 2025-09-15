import * as core from '@actions/core'
import {
  ApiClient,
  CredentialFetchingError,
  JobDetailsFetchingError
} from '../src/api-client'
import {HttpClientError} from '@actions/http-client'

describe('ApiClient', () => {
  const mockHttpClient: any = {
    getJson: jest.fn(),
    postJson: jest.fn()
  }

  // Define jobToken and credentialsToken
  const jobToken = 'xxx'
  const credentialsToken = 'yyy'

  const api = new ApiClient(
    mockHttpClient,
    {
      jobId: 1,
      jobToken,
      credentialsToken,
      dependabotApiUrl: 'https://localhost',
      dependabotApiDockerUrl: 'https://localhost',
      updaterImage: '' // irrelevant for this test
    },
    jobToken,
    credentialsToken
  )
  beforeEach(jest.clearAllMocks)

  test('getJobToken returns the correct job token', async () => {
    const actualJobToken = api.getJobToken()
    expect(actualJobToken).toBe(jobToken)
  })

  test('get job details', async () => {
    const apiResponse = {
      data: {
        id: '1001',
        type: 'update-jobs',
        attributes: {
          'allowed-updates': [
            {
              'dependency-type': 'direct',
              'update-type': 'all'
            }
          ],
          dependencies: null,
          'package-manager': 'npm_and_yarn'
        }
      }
    }
    mockHttpClient.getJson.mockResolvedValue({
      statusCode: 200,
      result: apiResponse
    })

    const jobDetails = await api.getJobDetails()
    expect(jobDetails['allowed-updates'].length).toBe(1)
    expect(jobDetails['package-manager']).toBe('npm_and_yarn')
  })

  test('job details errors', async () => {
    const apiResponse = {
      errors: [
        {
          status: 400,
          title: 'Bad Request',
          detail: 'Update job has already been processed'
        }
      ]
    }
    mockHttpClient.getJson.mockRejectedValue(
      new HttpClientError(JSON.stringify(apiResponse), 400)
    )

    await expect(api.getJobDetails()).rejects.toThrowError(
      new JobDetailsFetchingError(
        'fetching job details: unexpected status code: 400: {"errors":[{"status":400,"title":"Bad Request","detail":"Update job has already been processed"}]}'
      )
    )
  })

  test('job details with certificate error', async () => {
    mockHttpClient.getJson.mockRejectedValue(
      new Error('unable to get local issuer certificate')
    )

    await expect(api.getJobDetails()).rejects.toThrowError(
      new JobDetailsFetchingError(
        'fetching job details: Error: unable to get local issuer certificate'
      )
    )
  })

  test('job details retries on 500', async () => {
    mockHttpClient.getJson.mockRejectedValueOnce(
      new HttpClientError('retryable failure', 500)
    )

    const apiResponse = {
      data: {
        id: '1001',
        type: 'update-jobs',
        attributes: {
          'allowed-updates': [
            {
              'dependency-type': 'direct',
              'update-type': 'all'
            }
          ],
          dependencies: null,
          'package-manager': 'npm_and_yarn'
        }
      }
    }
    mockHttpClient.getJson.mockResolvedValue({
      statusCode: 200,
      result: apiResponse
    })

    const jobDetails = await api.getJobDetails()
    expect(jobDetails['allowed-updates'].length).toBe(1)
    expect(jobDetails['package-manager']).toBe('npm_and_yarn')
  })

  test('job details gives up on too many 500s', async () => {
    mockHttpClient.getJson.mockRejectedValue(
      new HttpClientError('retryable failure', 500)
    )

    await expect(api.getJobDetails()).rejects.toThrowError(
      new JobDetailsFetchingError(
        'fetching job details: unexpected status code: 500: retryable failure'
      )
    )
  }, 10000)

  test('get job credentials', async () => {
    const apiResponse = {
      data: {
        attributes: {
          credentials: [
            {
              type: 'no-creds',
              host: 'example.com',
              username: 'foo',
              password: null,
              token: null
            },
            {
              type: 'password',
              host: 'example.com',
              username: 'bar',
              password: 'bar-password',
              token: null
            },
            {
              type: 'token',
              host: 'example.com',
              username: 'baz',
              password: null,
              token: 'baz-token'
            },
            {
              type: 'both',
              host: 'example.com',
              username: 'qux',
              password: 'qux-password',
              token: 'qux-token'
            }
          ]
        }
      }
    }
    mockHttpClient.getJson.mockResolvedValue({
      statusCode: 200,
      result: apiResponse
    })
    jest.spyOn(core, 'setSecret').mockImplementation(jest.fn())

    const jobCredentials = await api.getCredentials()
    expect(jobCredentials.length).toBe(4)

    expect(core.setSecret).toHaveBeenCalledTimes(4)
    expect(core.setSecret).toHaveBeenCalledWith('bar-password')
    expect(core.setSecret).toHaveBeenCalledWith('baz-token')
    expect(core.setSecret).toHaveBeenCalledWith('qux-password')
    expect(core.setSecret).toHaveBeenCalledWith('qux-token')
  })

  test('job credentials errors', async () => {
    const apiResponse = {
      errors: [
        {
          status: 422,
          title: 'Secret Not Found',
          detail: 'MISSING_SECRET_NAME'
        }
      ]
    }

    mockHttpClient.getJson.mockRejectedValue(
      new HttpClientError(JSON.stringify(apiResponse), 422)
    )
    await expect(api.getCredentials()).rejects.toThrowError(
      new CredentialFetchingError(
        'fetching credentials: unexpected status code: 422: {"errors":[{"status":422,"title":"Secret Not Found","detail":"MISSING_SECRET_NAME"}]}'
      )
    )
  })

  test('sendMetrics sends metrics successfully', async () => {
    mockHttpClient.postJson.mockResolvedValue({statusCode: 204})

    await expect(
      api.sendMetrics('gitub_image_pull', 'increment', 1, {
        package_manager: 'npm_and_yarn'
      })
    ).resolves.not.toThrow()

    expect(mockHttpClient.postJson).toHaveBeenCalledWith(
      'https://localhost/update_jobs/1/record_metrics',
      {
        data: [
          {
            metric: 'dependabot.action.gitub_image_pull',
            type: 'increment',
            value: 1,
            tags: {package_manager: 'npm_and_yarn'}
          }
        ]
      },
      {Authorization: jobToken}
    )
  })

  test('sendMetrics logs warning but does not throw on failure', async () => {
    mockHttpClient.postJson.mockResolvedValue({statusCode: 500})
    jest.spyOn(core, 'warning').mockImplementation(jest.fn())

    await expect(
      api.sendMetrics('image_pull', 'increment', 1, {
        package_manager: 'npm_and_yarn'
      })
    ).resolves.not.toThrow()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Metrics reporting failed: Unexpected status code: 500'
      )
    )
  })

  test('reportMetrics throws on non-204 status', async () => {
    mockHttpClient.postJson.mockResolvedValue({statusCode: 400})

    await expect(
      api.reportMetrics({
        data: [
          {
            metric: 'dependabot.action.test_metric',
            type: 'increment',
            value: 1,
            tags: {package_manager: 'npm_and_yarn'}
          }
        ]
      })
    ).rejects.toThrow('Unexpected status code: 400')
  })
})
