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
    dependabotApiDockerUrl: 'https://localhost'
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
})
