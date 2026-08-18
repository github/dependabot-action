import {Updater} from '../src/updater'
import Docker from 'dockerode'
import {ContainerService} from '../src/container-service'
import {ProxyBuilder} from '../src/proxy'

// We do not need to build actual containers or run updates for this test.)
jest.mock('dockerode')
jest.mock('../src/container-service')
jest.mock('../src/proxy')

describe('Updater', () => {
  const mockApiClient: any = {
    getJobDetails: jest.fn(),
    getCredentials: jest.fn(),
    getJobToken: jest.fn(),
    params: {
      jobId: 1,
      dependabotApiUrl: 'http://localhost:3001'
    },
    jobToken: 'job-token',
    credentialsToken: 'job-credentials-token'
  }

  const mockJobDetails: any = {
    id: '1',
    'allowed-updates': [
      {
        'dependency-type': 'all'
      }
    ],
    'package-manager': 'npm-and-yarn'
  }

  const mockProxy: any = {
    container: {
      start: jest.fn()
    },
    waitUntilReady: jest.fn(),
    network: jest.fn(),
    networkName: 'mockNetworkName',
    url: () => {
      'http://localhost'
    },
    cert: 'mockCertificate',
    shutdown: jest.fn()
  }

  const mockContainer: any = {
    id: 1
  }

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
  })

  describe('when there is a happy path update', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      []
    )

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)
      mockProxy.waitUntilReady.mockResolvedValue(undefined)
      jest
        .spyOn(ContainerService, 'run')
        .mockImplementation(jest.fn(async () => true))
    })

    it('should be successful', async () => {
      expect(await updater.runUpdater()).toBe(true)
    })

    it('does not start the updater until the proxy is ready', async () => {
      const {promise, resolve} = Promise.withResolvers<void>()
      mockProxy.waitUntilReady.mockReturnValueOnce(promise)

      const runPromise = updater.runUpdater()
      await new Promise<void>(resolveImmediate =>
        setImmediate(resolveImmediate)
      )

      try {
        expect(jest.mocked(ContainerService).run.mock.calls).toHaveLength(0)
      } finally {
        resolve()
      }

      await expect(runPromise).resolves.toBe(true)
    })

    it('cleans up when the proxy does not become ready', async () => {
      mockProxy.waitUntilReady.mockRejectedValueOnce(
        new Error('proxy readiness timed out')
      )

      await expect(updater.runUpdater()).rejects.toThrow(
        'proxy readiness timed out'
      )
      expect(jest.mocked(ContainerService).run.mock.calls).toHaveLength(0)
      expect(mockProxy.shutdown.mock.calls).toHaveLength(1)
    })
  })

  describe('when the updater container fails', () => {
    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      mockJobDetails,
      []
    )

    beforeEach(async () => {
      jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      jest.spyOn(ProxyBuilder.prototype, 'run').mockResolvedValue(mockProxy)

      jest
        .spyOn(ContainerService, 'run')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('Call to container service errored'))
          )
        )
    })

    it('should raise an error', async () => {
      await expect(updater.runUpdater()).rejects.toThrow(
        'Call to container service errored'
      )
    })
  })

  describe('when given credentials', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org',
          username: 'npm_user',
          token: 'npm_token',
          'replaces-base': true
        }
      ]
    )

    it('generates credentials metadata on the job definition', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org',
          'replaces-base': true
        }
      ])
    })
  })

  describe('when given npm_registry credentials with a scope', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'npm_registry',
          registry:
            'jfrogghdemo.jfrog.io/artifactory/api/npm/dpndbt-pvt-repo-npm-key/',
          username: 'npm_user',
          token: 'npm_token',
          scope: '@mycompany'
        }
      ]
    )

    it('generates credentials metadata with the scope', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'npm_registry',
          registry:
            'jfrogghdemo.jfrog.io/artifactory/api/npm/dpndbt-pvt-repo-npm-key/',
          scope: '@mycompany'
        }
      ])
    })
  })

  describe('when given npm_registry credentials with a URL and not a registry', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'npm_registry',
          url: 'https://registry.npmjs.org/some/path',
          username: 'npm_user',
          token: 'npm_token'
        }
      ]
    )

    it('generates credentials metadata with the registry from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'npm_registry',
          registry: 'registry.npmjs.org/some/path',
          url: 'https://registry.npmjs.org/some/path'
        }
      ])
    })
  })

  describe('when given npm_registry credentials with a URL and not a registry with no path', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'npm_registry',
          url: 'https://registry.npmjs.org',
          username: 'npm_user',
          token: 'npm_token'
        }
      ]
    )

    it('generates credentials metadata with the registry from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'npm_registry',
          registry: 'registry.npmjs.org/',
          url: 'https://registry.npmjs.org'
        }
      ])
    })
  })

  describe('when given docker credentials with a URL and not a registry', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'docker_registry',
          url: 'https://ghcr.io/some/path',
          username: 'user',
          token: 'token'
        }
      ]
    )

    it('generates credentials metadata with the registry from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'docker_registry',
          registry: 'ghcr.io',
          url: 'https://ghcr.io/some/path'
        }
      ])
    })
  })

  describe('when given python credentials with a URL and not an index-url', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'python_index',
          url: 'https://example.com/some/path',
          username: 'user',
          token: 'token'
        }
      ]
    )

    it('generates credentials metadata with the index from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          'index-url': 'https://example.com/some/path',
          type: 'python_index',
          url: 'https://example.com/some/path'
        }
      ])
    })
  })

  describe('when given composer credentials with a URL and not a registry', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'composer_repository',
          url: 'https://example.com/some/path',
          username: 'user',
          token: 'token'
        }
      ]
    )

    it('generates credentials metadata with the registry from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'composer_repository',
          registry: 'example.com',
          url: 'https://example.com/some/path'
        }
      ])
    })
  })

  describe('when given npm_registry credentials with a URL and not a registry, but the URL is malformed', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'npm_registry',
          url: 'not-a-url',
          username: 'npm_user',
          token: 'npm_token'
        }
      ]
    )

    it('generates credentials metadata with the registry from the URL', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'npm_registry',
          url: 'not-a-url'
        }
      ])
    })
  })

  describe('when given duplicate credentials', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        }
      ]
    )

    it('removes duplicates from the metadata', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        }
      ])
    })
  })

  describe('when given a jit_access type credential', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'jit_access',
          host: 'github.com',
          token: 'hello'
        }
      ]
    )

    it('removes it from the metadata', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        }
      ])
    })
  })

  describe('when given a tenant-id and client-id in credentials', () => {
    const jobDetails = {...mockJobDetails}

    new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      jobDetails,
      [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'user',
          password: 'pass'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org',
          'tenant-id': '12345678-1234-1234-1234-123456789012',
          'client-id': '87654321-4321-4321-4321-210987654321'
        }
      ]
    )

    it('they are excluded from the credentials metadata', () => {
      expect(jobDetails['credentials-metadata']).toEqual([
        {
          type: 'git_source',
          host: 'github.com'
        },
        {
          type: 'npm_registry',
          host: 'registry.npmjs.org'
        }
      ])
    })
  })

  describe('when the split fetch/update experiment is enabled', () => {
    const splitJobDetails: any = {
      ...mockJobDetails,
      experiments: {isolate_fetch_update: true},
      source: {repo: 'dependabot/example'}
    }

    const credentials = [
      {
        type: 'git_source',
        host: 'github.com',
        username: 'x-access-token',
        password: 'target-repo-token'
      },
      {
        type: 'git_source',
        host: 'github.com',
        repo: 'dependabot/other',
        username: 'x-access-token',
        password: 'other-repo-token'
      },
      {
        type: 'npm_registry',
        host: 'registry.npmjs.org',
        token: 'npm_token'
      }
    ]

    let proxyRun: jest.SpyInstance
    let runFileFetcher: jest.SpyInstance
    let runFileUpdater: jest.SpyInstance
    let runSingleContainer: jest.SpyInstance
    let storeInput: jest.SpyInstance
    let createContainer: jest.SpyInstance
    let removeCloneVolume: jest.Mock
    let removeHandoffVolume: jest.Mock

    const updater = new Updater(
      'MOCK_UPDATER_IMAGE_NAME',
      'MOCK_PROXY_IMAGE_NAME',
      mockApiClient,
      splitJobDetails,
      credentials
    )

    beforeEach(async () => {
      removeCloneVolume = jest.fn().mockResolvedValue(undefined)
      removeHandoffVolume = jest.fn().mockResolvedValue(undefined)
      jest
        .spyOn(Docker.prototype, 'createVolume')
        .mockResolvedValueOnce({
          name: 'dependabot-job-1-clone',
          remove: removeCloneVolume
        } as any)
        .mockResolvedValueOnce({
          name: 'dependabot-job-1-handoff',
          remove: removeHandoffVolume
        } as any)

      createContainer = jest
        .spyOn(Docker.prototype, 'createContainer')
        .mockResolvedValue(mockContainer)

      proxyRun = jest
        .spyOn(ProxyBuilder.prototype, 'run')
        .mockResolvedValue(mockProxy)

      runFileFetcher = jest
        .spyOn(ContainerService, 'runFileFetcher')
        .mockResolvedValue()
      runFileUpdater = jest
        .spyOn(ContainerService, 'runFileUpdater')
        .mockResolvedValue()
      runSingleContainer = jest
        .spyOn(ContainerService, 'run')
        .mockResolvedValue(true)
      storeInput = jest.spyOn(ContainerService, 'storeInput')
    })

    it('runs the fetch and update phases in separate containers', async () => {
      expect(await updater.runUpdater()).toBe(true)

      expect(runFileFetcher).toHaveBeenCalledTimes(1)
      expect(runFileUpdater).toHaveBeenCalledTimes(1)
      expect(runSingleContainer).not.toHaveBeenCalled()
    })

    it('starts a separate proxy per phase', async () => {
      await updater.runUpdater()

      expect(proxyRun).toHaveBeenCalledTimes(2)
      expect(proxyRun.mock.calls[0][4]).toBe('fetch')
      expect(proxyRun.mock.calls[1][4]).toBe('update')
    })

    it('passes the full credential set to both phase proxies', async () => {
      await updater.runUpdater()

      expect(proxyRun.mock.calls[0][3]).toEqual(credentials)
      expect(proxyRun.mock.calls[1][3]).toEqual(credentials)
    })

    it('shuts the fetch proxy down before the update phase starts', async () => {
      const order: string[] = []
      mockProxy.shutdown.mockImplementation(async () => {
        order.push('shutdown')
      })
      runFileUpdater.mockImplementation(async () => {
        order.push('update')
      })

      await updater.runUpdater()

      expect(order).toEqual(['shutdown', 'update', 'shutdown'])
    })

    it('gives each phase its own container name', async () => {
      await updater.runUpdater()

      expect(createContainer.mock.calls[0][0].name).toBe(
        'dependabot-job-1-file-fetcher'
      )
      expect(createContainer.mock.calls[1][0].name).toBe(
        'dependabot-job-1-updater'
      )
    })

    it('gives both phases the normal job input', async () => {
      await updater.runUpdater()

      expect(storeInput.mock.calls[0][3]).toEqual({job: splitJobDetails})
      expect(storeInput.mock.calls[1][3]).toEqual({job: splitJobDetails})
    })

    it('hands the fetched checkout to the update phase in a separate volume', async () => {
      await updater.runUpdater()

      expect(createContainer.mock.calls[0][0].HostConfig.Mounts).toEqual([
        {
          Type: 'volume',
          Source: 'dependabot-job-1-clone',
          Target: '/home/dependabot/dependabot-updater/repo'
        },
        {
          Type: 'volume',
          Source: 'dependabot-job-1-handoff',
          Target: '/home/dependabot/dependabot-updater/repo-handoff'
        }
      ])
      expect(createContainer.mock.calls[1][0].HostConfig.Mounts).toEqual([
        {
          Type: 'volume',
          Source: 'dependabot-job-1-handoff',
          Target: '/home/dependabot/dependabot-updater/repo'
        }
      ])
      expect(removeCloneVolume).toHaveBeenCalledTimes(1)
      expect(removeHandoffVolume).toHaveBeenCalledTimes(1)
    })

    it('reports a repository volume cleanup failure after a successful run', async () => {
      removeCloneVolume.mockRejectedValue(new Error('volume cleanup failed'))

      await expect(updater.runUpdater()).rejects.toThrow(
        'volume cleanup failed'
      )
    })

    it('does not mask a fetch failure with a volume cleanup failure', async () => {
      runFileFetcher.mockRejectedValue(new Error('fetch failed'))
      removeCloneVolume.mockRejectedValue(new Error('volume cleanup failed'))

      await expect(updater.runUpdater()).rejects.toThrow('fetch failed')
    })

    it('does not clean up the update phase proxy until the update fails', async () => {
      runFileUpdater.mockRejectedValue(new Error('update failed'))

      await expect(updater.runUpdater()).rejects.toThrow('update failed')

      // One shutdown for the fetch proxy, one for the update proxy.
      expect(mockProxy.shutdown).toHaveBeenCalledTimes(2)
      expect(removeCloneVolume).toHaveBeenCalledTimes(1)
      expect(removeHandoffVolume).toHaveBeenCalledTimes(1)
    })

    it('does not start the update phase when the fetch phase fails', async () => {
      runFileFetcher.mockRejectedValue(new Error('fetch failed'))

      await expect(updater.runUpdater()).rejects.toThrow('fetch failed')

      expect(runFileUpdater).not.toHaveBeenCalled()
      expect(proxyRun).toHaveBeenCalledTimes(1)
      expect(mockProxy.shutdown).toHaveBeenCalledTimes(1)
      expect(removeCloneVolume).toHaveBeenCalledTimes(1)
      expect(removeHandoffVolume).toHaveBeenCalledTimes(1)
    })

    it('forwards the graph command to the update phase', async () => {
      const graphUpdater = new Updater(
        'MOCK_UPDATER_IMAGE_NAME',
        'MOCK_PROXY_IMAGE_NAME',
        mockApiClient,
        {...splitJobDetails, command: 'graph'},
        credentials
      )

      await graphUpdater.runUpdater()

      expect(runFileUpdater).toHaveBeenCalledWith(mockContainer, 'graph')
    })

    it.each([
      ['the experiment is absent', {}],
      ['the experiment is disabled', {isolate_fetch_update: false}]
    ])('uses the single container path when %s', async (_name, experiments) => {
      const legacyUpdater = new Updater(
        'MOCK_UPDATER_IMAGE_NAME',
        'MOCK_PROXY_IMAGE_NAME',
        mockApiClient,
        {...splitJobDetails, experiments},
        credentials
      )

      expect(await legacyUpdater.runUpdater()).toBe(true)

      expect(runSingleContainer).toHaveBeenCalledTimes(1)
      expect(runFileFetcher).not.toHaveBeenCalled()
      expect(runFileUpdater).not.toHaveBeenCalled()
      // The legacy path starts one unphased proxy with the full credential set.
      expect(proxyRun).toHaveBeenCalledTimes(1)
      expect(proxyRun.mock.calls[0][3]).toEqual(credentials)
      expect(proxyRun.mock.calls[0][4]).toBeUndefined()
    })
  })
})
