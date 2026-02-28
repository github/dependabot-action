import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {
  ApiClient,
  Credential,
  JobDetails,
  CredentialFetchingError,
  JobDetailsFetchingError
} from '../src/api-client'
import {ContainerRuntimeError} from '../src/container-service'
import {Updater} from '../src/updater'
import {ImageService, MetricReporter} from '../src/image-service'
import {updaterImageName} from '../src/docker-tags'
import * as inputs from '../src/inputs'
import {run, credentialsFromEnv, getPackagesCredential} from '../src/main'

import {eventFixturePath} from './helpers'

// We do not need to build actual containers or run updates for this test.
jest.mock('../src/image-service')
jest.mock('../src/updater')

describe('run', () => {
  let context: Context

  let markJobAsProcessedSpy: any
  let reportJobErrorSpy: any
  let sendMetricsSpy: jest.SpyInstance

  beforeEach(async () => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    process.env.GITHUB_SERVER_URL = 'https://test.dev'
    process.env.GITHUB_REPOSITORY = 'foo/bar'

    process.env.GITHUB_DEPENDABOT_JOB_TOKEN = 'xxx'
    process.env.GITHUB_DEPENDABOT_CRED_TOKEN = 'yyy'

    markJobAsProcessedSpy = jest.spyOn(
      ApiClient.prototype,
      'markJobAsProcessed'
    )
    markJobAsProcessedSpy.mockImplementation(jest.fn())
    reportJobErrorSpy = jest.spyOn(ApiClient.prototype, 'reportJobError')
    reportJobErrorSpy.mockImplementation(jest.fn())
    jest
      .spyOn(ApiClient.prototype, 'getCredentials')
      .mockImplementation(jest.fn())
    jest
      .spyOn(ApiClient.prototype, 'getJobDetails')
      .mockImplementation(jest.fn())

    jest.spyOn(core, 'info').mockImplementation(jest.fn())
    jest.spyOn(core, 'warning').mockImplementation(jest.fn())
    jest.spyOn(core, 'setFailed').mockImplementation(jest.fn())
    sendMetricsSpy = jest
      .spyOn(ApiClient.prototype, 'sendMetrics')
      .mockResolvedValue()
  })

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
  })

  describe('when the run follows the happy path', () => {
    beforeEach(() => {
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })

    test('it defers reporting back to dependabot-api to the updater itself', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when an updaterImage is not specified', () => {
    beforeEach(() => {
      context = new Context()
      context.payload = {
        ...context.payload,
        inputs: {
          ...context.payload.inputs,
          updaterImage: null
        }
      }
      jest.spyOn(ImageService, 'pull')

      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )
    })

    test('it runs with the pinned image and sends metrics correctly', async () => {
      await run(context)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ImageService.pull).toHaveBeenCalledWith(
        updaterImageName('npm_and_yarn'),
        expect.any(Function)
      )

      const metricFn = (ImageService.pull as jest.Mock).mock.calls[0][1]

      // Invoke the captured function to ensure it behaves correctly
      await metricFn('test_metric', 'increment', 5)

      expect(sendMetricsSpy).toHaveBeenCalledWith(
        'test_metric',
        'increment',
        5,
        {package_manager: 'npm_and_yarn'}
      )
    })

    test('it correctly passes metric reporter with package manager tag', async () => {
      context = new Context()
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockResolvedValue({
        'package-manager': 'npm_and_yarn',
        'allowed-updates': [],
        'credentials-metadata': [],
        id: '1',
        experiments: {},
        source: {repo: 'test-org/test-repo'}
      })

      const pullSpy = jest
        .spyOn(ImageService, 'pull')
        .mockImplementation(jest.fn())
      await run(context)

      expect(pullSpy).toHaveBeenCalledWith(
        updaterImageName('npm_and_yarn'),
        expect.any(Function)
      )

      const metricReporter = (ImageService.pull as jest.Mock).mock
        .calls[0][1] as MetricReporter

      // explicitly call this metric reporter to ensure correctness
      await metricReporter('test_metric', 'increment', 3, {custom_tag: 'foo'})

      expect(sendMetricsSpy).toHaveBeenCalledWith(
        'test_metric',
        'increment',
        3,
        {package_manager: 'npm_and_yarn', custom_tag: 'foo'}
      )
    })
  })

  describe('when an updaterImage is specified', () => {
    beforeEach(() => {
      context = new Context()
      context.payload = {
        ...context.payload,
        inputs: {
          ...context.payload.inputs,
          updaterImage: 'alpine'
        }
      }
      jest.spyOn(ImageService, 'pull')
    })

    test('it runs with the specified image', async () => {
      await run(context)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ImageService.pull).toHaveBeenCalledWith(
        'alpine',
        expect.any(Function)
      )
    })
  })

  describe('when the action is triggered by a different actor', () => {
    beforeEach(() => {
      process.env.GITHUB_ACTOR = 'classic-rando'
      process.env.GITHUB_TRIGGERING_ACTOR = 'classic-rando'
      context = new Context()
    })

    test('it skips the rest of the job', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.warning).toHaveBeenCalledWith(
        "This workflow can only be triggered by Dependabot. Actor was 'classic-rando'."
      )
    })

    test('it does not report this failed run to dependabot-api', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when the action is retriggered by a different actor', () => {
    beforeEach(() => {
      process.env.GITHUB_ACTOR = 'dependabot[bot]'
      process.env.GITHUB_TRIGGERING_ACTOR = 'classic-rando'
      context = new Context()
    })

    test('it skips the rest of the job', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.warning).toHaveBeenCalledWith(
        'Dependabot workflows cannot be re-run. Retrigger this update via Dependabot instead.'
      )
    })

    test('it does not report this failed run to dependabot-api', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when the action is triggered on an unsupported event', () => {
    beforeEach(() => {
      process.env.GITHUB_EVENT_NAME = 'issue_created'
      context = new Context()
    })

    test('it skips the rest of the job', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.warning).toHaveBeenCalledWith(
        "Dependabot Updater Action does not support 'issue_created' events."
      )
    })

    test('it does not report this failed run to dependabot-api', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when there is an error retrieving job parameters', () => {
    beforeEach(() => {
      jest.spyOn(inputs, 'getJobParameters').mockImplementationOnce(
        jest.fn(() => {
          throw new Error('unexpected error retrieving job params')
        })
      )

      context = new Context()
    })

    test('it fails the workflow with the raw error', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Dependabot encountered an unexpected problem\n\nError: unexpected error retrieving job params\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access to the repository is required to view the log)`
      )
    })

    test('it does not inform dependabot-api as it cannot instantiate a client without the params', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when there is an error retrieving job details from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(ApiClient.prototype, 'getJobDetails')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(
              new JobDetailsFetchingError(
                'fetching job details: received code 400: more details'
              )
            )
          )
        )

      context = new Context()
    })

    test('it fails the workflow with the raw error', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Dependabot encountered an unexpected problem\n\nError: fetching job details: received code 400: more details\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access to the repository is required to view the log)`
      )
    })

    test('it does not inform dependabot-api as the job may not be in a writeable state', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when there is an API error retrieving job credentials from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(ApiClient.prototype, 'getCredentials')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(
              new CredentialFetchingError(
                'fetching credentials: received code 422: more details'
              )
            )
          )
        )

      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(
          'fetching credentials: received code 422: more details'
        )
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_updater',
        'error-details': {
          'action-error':
            'fetching credentials: received code 422: more details'
        }
      })
      expect(markJobAsProcessedSpy).toHaveBeenCalled()
    })
  })

  describe('when there is an unexpected error retrieving job credentials from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(ApiClient.prototype, 'getCredentials')
        .mockImplementationOnce(
          jest.fn(async () => Promise.reject(new Error('something went wrong')))
        )

      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('something went wrong')
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_unknown',
        'error-details': {
          'action-error': 'something went wrong'
        }
      })
      expect(markJobAsProcessedSpy).toHaveBeenCalled()
    })
  })

  describe('when there is an error pulling all images', () => {
    beforeEach(() => {
      jest
        .spyOn(ImageService, 'pull')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error pulling an image'))
          )
        )
        .mockImplementationOnce(
          // when calling Azure
          jest.fn(async () =>
            Promise.reject(new Error('error pulling an image'))
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {
            'package-manager': 'npm_and_yarn',
            experiments: {'azure-registry-backup': true}
          } as JobDetails
        })
      )
      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error pulling an image')
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_image',
        'error-details': {
          'action-error': 'error pulling an image'
        }
      })
      expect(markJobAsProcessedSpy).toHaveBeenCalled()
    })
  })

  describe('when there is an error pulling first images', () => {
    beforeEach(() => {
      jest
        .spyOn(ImageService, 'pull')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error pulling an image'))
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {
            'package-manager': 'npm_and_yarn',
            experiments: {'azure-registry-backup': true}
          } as JobDetails
        })
      )
      context = new Context()
    })

    test('it succeeds the workflow', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })
  })

  describe('when there the update container exits with an error signal', () => {
    beforeEach(() => {
      jest
        .spyOn(Updater.prototype, 'runUpdater')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new ContainerRuntimeError('the container melted'))
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )
      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Dependabot encountered an error performing the update\n\nError: the container melted\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access to the repository is required to view the log)`
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_updater',
        'error-details': {
          'action-error': 'the container melted'
        }
      })
      expect(markJobAsProcessedSpy).toHaveBeenCalled()
    })
  })

  describe('when there is an unexpected error running the update', () => {
    beforeEach(() => {
      jest
        .spyOn(Updater.prototype, 'runUpdater')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error running the update'))
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )
      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Dependabot encountered an error performing the update\n\nError: error running the update\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access to the repository is required to view the log)`
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_updater',
        'error-details': {
          'action-error': 'error running the update'
        }
      })
      expect(markJobAsProcessedSpy).toHaveBeenCalled()
    })
  })

  describe('when the there is no job token', () => {
    beforeEach(() => {
      jest.spyOn(inputs, 'getJobParameters').mockReturnValueOnce(
        new inputs.JobParameters(
          1,
          '', // jobToken set as empty
          'cred-token',
          'https://example.com',
          '172.17.0.1',
          'image/name:tag'
        )
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = ''
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = 'yyy'
      context = new Context()
    })

    test('it fails the workflow with the specific error message for missing job token', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Github Dependabot job token is not set`
      )
    })

    test('it does not report this failed run to dependabot-api', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })

    test('it does not inform dependabot-api as it cannot instantiate a client without the params', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when the there is no cred token', () => {
    beforeEach(() => {
      jest.spyOn(inputs, 'getJobParameters').mockReturnValueOnce(
        new inputs.JobParameters(
          1,
          'job-token',
          '', // credToken set as empty
          'https://example.com',
          '172.17.0.1',
          'image/name:tag'
        )
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = 'xxx'
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = ''
      context = new Context()
    })

    test('it fails the workflow with the specific error message for missing credentials token', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Github Dependabot credentials token is not set`
      )
    })

    test('it does not report this failed run to dependabot-api', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })

    test('it does not inform dependabot-api as it cannot instantiate a client without the params', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when only the job token is provided through the Action environment', () => {
    beforeEach(() => {
      jest
        .spyOn(inputs, 'getJobParameters')
        .mockReturnValueOnce(
          new inputs.JobParameters(
            1,
            '',
            '',
            'https://example.com',
            '172.17.0.1',
            'image/name:tag'
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = 'xxx'
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = 'yyy'
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })

    test('it defers reporting back to dependabot-api to the updater itself', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when only the cred token is provided through the Action environment', () => {
    beforeEach(() => {
      jest
        .spyOn(inputs, 'getJobParameters')
        .mockReturnValueOnce(
          new inputs.JobParameters(
            1,
            '',
            '',
            'https://example.com',
            '172.17.0.1',
            'image/name:tag'
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = 'xxx'
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = 'yyy'
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })

    test('it defers reporting back to dependabot-api to the updater itself', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  // The below tests are to support backward compatibility when the job token and cred token
  // are not provided through the Action environment
  describe('when only the job token is provided through the jobParmeters', () => {
    beforeEach(() => {
      jest
        .spyOn(inputs, 'getJobParameters')
        .mockReturnValueOnce(
          new inputs.JobParameters(
            1,
            'xxx',
            'yyy',
            'https://example.com',
            '172.17.0.1',
            'image/name:tag'
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = ''
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = ''
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })

    test('it defers reporting back to dependabot-api to the updater itself', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when only the cred token is provided through the jobParmeters', () => {
    beforeEach(() => {
      jest
        .spyOn(inputs, 'getJobParameters')
        .mockReturnValueOnce(
          new inputs.JobParameters(
            1,
            'xxx',
            'yyy',
            'https://example.com',
            '172.17.0.1',
            'image/name:tag'
          )
        )
      jest.spyOn(ApiClient.prototype, 'getJobDetails').mockImplementationOnce(
        jest.fn(async () => {
          return {'package-manager': 'npm_and_yarn'} as JobDetails
        })
      )

      process.env.GITHUB_DEPENDABOT_JOB_TOKEN = ''
      process.env.GITHUB_DEPENDABOT_CRED_TOKEN = ''
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~ finished ~')
      )
    })

    test('it defers reporting back to dependabot-api to the updater itself', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })
})

describe('credentialsFromEnv', () => {
  const originalEnv = process.env.GITHUB_REGISTRIES_PROXY
  afterEach(() => {
    process.env.GITHUB_REGISTRIES_PROXY = originalEnv
    jest.clearAllMocks()
  })

  it('returns an empty array if GITHUB_REGISTRIES_PROXY is not set', () => {
    delete process.env.GITHUB_REGISTRIES_PROXY
    expect(credentialsFromEnv()).toEqual([])
  })

  it('returns an empty array if GITHUB_REGISTRIES_PROXY is not valid base64', () => {
    process.env.GITHUB_REGISTRIES_PROXY = 'not-base64!'
    expect(credentialsFromEnv()).toEqual([])
  })

  it('returns an empty array if GITHUB_REGISTRIES_PROXY is not valid JSON', () => {
    process.env.GITHUB_REGISTRIES_PROXY =
      Buffer.from('not-json').toString('base64')
    expect(credentialsFromEnv()).toEqual([])
  })

  it('returns parsed credentials and masks secrets', () => {
    const creds = [
      {
        url: 'https://foo',
        username: 'bar',
        password: 'baz',
        token: 'tok',
        host: 'h',
        'replaces-base': false
      }
    ]
    process.env.GITHUB_REGISTRIES_PROXY = Buffer.from(
      JSON.stringify(creds)
    ).toString('base64')
    const setSecretSpy = jest.spyOn(core, 'setSecret')
    const result = credentialsFromEnv()
    expect(result).toEqual(creds)
    expect(setSecretSpy).toHaveBeenCalledWith('baz')
    expect(setSecretSpy).toHaveBeenCalledWith('tok')
    expect(setSecretSpy).not.toHaveBeenCalledWith('bar')
    expect(setSecretSpy).not.toHaveBeenCalledWith('https://foo')
  })
})

describe('getPackagesCredential', () => {
  const experimentName = 'automatic_github_packages_auth'
  const alternateExperimentName = experimentName.replace(/_/g, '-')
  function createJobDetails(
    packageManager: string,
    experiments: {[key: string]: boolean},
    credentialsMetadata: Credential[] = []
  ): JobDetails {
    return {
      'package-manager': packageManager,
      'allowed-updates': [],
      'credentials-metadata': credentialsMetadata,
      id: '1',
      experiments,
      source: {repo: 'test-org/test-repo'}
    }
  }

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  describe('when the package manager is unsupported', () => {
    it('returns null', () => {
      const details = createJobDetails('unsupported-package-manager', {
        [experimentName]: true
      })
      const cred = getPackagesCredential(details, 'test-actor')
      expect(cred).toBeNull()
    })
  })

  describe('when the package manager is bundler', () => {
    describe('when automatic package auth is enabled', () => {
      it('creates a GitHub packages credential', () => {
        const details = createJobDetails('bundler', {[experimentName]: true})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'rubygems_server',
          host: 'rubygems.pkg.github.com',
          token: 'test-actor:test-token'
        })
      })

      it('does not create a duplicate credential', () => {
        const existingCred: Credential = {
          type: 'rubygems_server',
          host: 'rubygems.pkg.github.com',
          token: 'some-other-actor:some-other-token'
        }
        const details = createJobDetails('bundler', {[experimentName]: true}, [
          existingCred
        ])
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })
  })

  describe('when the package manager is docker', () => {
    describe('when automatic package auth is enabled', () => {
      it('creates a GitHub packages credential', () => {
        const details = createJobDetails('docker', {[experimentName]: true})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'docker_registry',
          registry: 'ghcr.io',
          username: 'test-actor',
          password: 'test-token'
        })
      })

      it('does not create a duplicate credential', () => {
        const existingCred: Credential = {
          type: 'docker_registry',
          registry: 'ghcr.io',
          username: 'some-other-actor',
          password: 'some-other-token'
        }
        const details = createJobDetails('docker', {[experimentName]: true}, [
          existingCred
        ])
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })
  })

  describe('when the package manager is maven', () => {
    describe('when automatic package auth is enabled', () => {
      it('creates a GitHub packages credential', () => {
        const details = createJobDetails('maven', {[experimentName]: true})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'maven_repository',
          url: 'https://maven.pkg.github.com/test-org',
          username: 'test-actor',
          password: 'test-token'
        })
      })

      it('does not create a duplicate credential with no trailing slash', () => {
        const existingCred: Credential = {
          type: 'maven_repository',
          url: 'https://maven.pkg.github.com/TEST-ORG',
          username: 'some-other-actor',
          password: 'some-other-token'
        }
        const details = createJobDetails('maven', {[experimentName]: true}, [
          existingCred
        ])
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })

      it('does not create a duplicate credential with a trailing slash', () => {
        const existingCred: Credential = {
          type: 'maven_repository',
          url: 'https://maven.pkg.github.com/TEST-ORG/',
          username: 'some-other-actor',
          password: 'some-other-token'
        }
        const details = createJobDetails('maven', {[experimentName]: true}, [
          existingCred
        ])
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })
  })

  describe('when the package manager is npm_and_yarn', () => {
    describe('when automatic package auth is enabled', () => {
      it('creates a GitHub packages credential', () => {
        const details = createJobDetails('npm_and_yarn', {
          [experimentName]: true
        })
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'npm_registry',
          registry: 'npm.pkg.github.com',
          token: 'test-actor:test-token'
        })
      })

      it('does not create a duplicate credential', () => {
        const existingCred: Credential = {
          type: 'npm_registry',
          registry: 'npm.pkg.github.com',
          token: 'some-other-actor:some-other-token'
        }
        const details = createJobDetails(
          'npm_and_yarn',
          {[experimentName]: true},
          [existingCred]
        )
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })
  })

  describe('when the package manager is nuget', () => {
    describe('when automatic package auth is not set', () => {
      it('returns null', () => {
        const details = createJobDetails('nuget', {})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })

    describe('when automatic package auth is disabled', () => {
      it('returns null', () => {
        const details = createJobDetails('nuget', {[experimentName]: false})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })

    describe('when GITHUB_TOKEN is not set', () => {
      it('returns null', () => {
        delete process.env.GITHUB_TOKEN
        const details = createJobDetails('nuget', {[experimentName]: true})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })

    describe('when automatic package auth is enabled', () => {
      it('creates a GitHub packages credential', () => {
        const details = createJobDetails('nuget', {[experimentName]: true})
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'nuget_feed',
          url: 'https://nuget.pkg.github.com/test-org/index.json',
          username: 'test-actor',
          password: 'test-token'
        })
      })

      it('creates a GitHub packages credential with alternate experiment name', () => {
        const details = createJobDetails('nuget', {
          [alternateExperimentName]: true
        })
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toEqual({
          type: 'nuget_feed',
          url: 'https://nuget.pkg.github.com/test-org/index.json',
          username: 'test-actor',
          password: 'test-token'
        })
      })

      it('does not create a duplicate credential', () => {
        const existingCred: Credential = {
          type: 'nuget_feed',
          url: 'https://nuget.pkg.github.com/TEST-ORG/index.json',
          username: 'some-other-actor',
          password: 'some-other-token'
        }
        const details = createJobDetails('nuget', {[experimentName]: true}, [
          existingCred
        ])
        const cred = getPackagesCredential(details, 'test-actor')
        expect(cred).toBeNull()
      })
    })
  })
})
