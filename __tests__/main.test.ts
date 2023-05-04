import fs from 'fs'
import path from 'path'
import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {ApiClient, JobDetails, CredentialFetchingError} from '../src/api-client'
import {ContainerRuntimeError} from '../src/container-service'
import {Updater} from '../src/updater'
import {ImageService} from '../src/image-service'
import {updaterImageName} from '../src/docker-tags'
import * as inputs from '../src/inputs'
import {run} from '../src/main'

import {eventFixturePath} from './helpers'

// We do not need to build actual containers or run updates for this test.
jest.mock('../src/image-service')
jest.mock('../src/updater')

describe('run', () => {
  let context: Context
  const workspace = path.join(__dirname, '..', 'tmp')
  const workingDirectory = path.join(workspace, './test_working_directory')

  let markJobAsProcessedSpy: any
  let reportJobErrorSpy: any

  beforeEach(async () => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

    process.env.GITHUB_SERVER_URL = 'https://test.dev'
    process.env.GITHUB_REPOSITORY = 'foo/bar'

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

    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
    fs.rmdirSync(workingDirectory)
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

    test('it runs with the pinned image', async () => {
      await run(context)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ImageService.pull).toHaveBeenCalledWith(
        updaterImageName('npm_and_yarn')
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
      expect(ImageService.pull).toHaveBeenCalledWith('alpine')
    })
  })

  describe('when the action is triggered by a different actor', () => {
    beforeEach(() => {
      process.env.GITHUB_ACTOR = 'classic-rando'
      context = new Context()
    })

    test('it skips the rest of the job', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.warning).toHaveBeenCalledWith(
        'This workflow can only be triggered by Dependabot.'
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
        `Dependabot encountered an unexpected problem\n\nError: unexpected error retrieving job params\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access required)`
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
            Promise.reject(new Error('error getting job details'))
          )
        )

      context = new Context()
    })

    test('it fails the workflow with the raw error', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        `Dependabot encountered an unexpected problem\n\nError: error getting job details\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access required)`
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

  describe('when there is an error pulling images', () => {
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
          return {'package-manager': 'npm_and_yarn'} as JobDetails
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
        `Dependabot encountered an error performing the update\n\nError: the container melted\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access required)`
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
        `Dependabot encountered an error performing the update\n\nError: error running the update\n\nFor more information see: https://test.dev/foo/bar/network/updates/1 (write access required)`
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
})
