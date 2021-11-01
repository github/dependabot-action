import * as core from '@actions/core'
import {ApiClient} from '../src/api-client'

describe('ApiClient', () => {
  const mockAxios: any = {
    get: jest.fn()
  }
  const api = new ApiClient(mockAxios, {
    jobId: 1,
    jobToken: 'xxx',
    credentialsToken: 'yyy',
    dependabotApiUrl: 'https://localhost',
    dependabotApiDockerUrl: 'https://localhost',
    workingDirectory: './job-directory'
  })
  beforeEach(jest.clearAllMocks)

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
    mockAxios.get.mockResolvedValue({status: 200, data: apiResponse})

    const jobDetails = await api.getJobDetails()
    expect(jobDetails['allowed-updates'].length).toBe(1)
    expect(jobDetails['package-manager']).toBe('npm_and_yarn')
  })

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
    mockAxios.get.mockResolvedValue({status: 200, data: apiResponse})
    jest.spyOn(core, 'setSecret').mockImplementation(jest.fn())

    const jobCredentials = await api.getCredentials()
    expect(jobCredentials.length).toBe(4)

    expect(core.setSecret).toHaveBeenCalledTimes(4)
    expect(core.setSecret).toHaveBeenCalledWith('bar-password')
    expect(core.setSecret).toHaveBeenCalledWith('baz-token')
    expect(core.setSecret).toHaveBeenCalledWith('qux-password')
    expect(core.setSecret).toHaveBeenCalledWith('qux-token')
  })
})
