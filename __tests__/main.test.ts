import fs from 'fs'
import path from 'path'
import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {ApiClient} from '../src/api-client'
import {Updater} from '../src/updater'
import {ImageService} from '../src/image-service'
import * as inputs from '../src/inputs'
import {run} from '../src/main'

import {eventFixturePath} from './helpers'

// We do not need to build actual containers or run updates for this test.
jest.mock('../src/api-client')
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

    markJobAsProcessedSpy = jest.spyOn(
      ApiClient.prototype,
      'markJobAsProcessed'
    )
    reportJobErrorSpy = jest.spyOn(ApiClient.prototype, 'reportJobError')

    jest.spyOn(core, 'info').mockImplementation(jest.fn())
    jest.spyOn(core, 'setFailed').mockImplementation(jest.fn())

    fs.mkdirSync(workingDirectory)
  })

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
    fs.rmdirSync(workingDirectory)
  })

  describe('when the run follows the happy path', () => {
    beforeEach(() => {
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

  describe('when the action is triggered by a different actor', () => {
    beforeEach(() => {
      process.env.GITHUB_ACTOR = 'classic-rando'
      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
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

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
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
        new Error('unexpected error retrieving job params')
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
        new Error('error getting job details')
      )
    })

    test('it does not inform dependabot-api as the job may not be in a writeable state', async () => {
      await run(context)

      expect(markJobAsProcessedSpy).not.toHaveBeenCalled()
      expect(reportJobErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('when there is an error retrieving job credentials from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(ApiClient.prototype, 'getCredentials')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error getting credentials'))
          )
        )

      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error getting credentials')
      )
    })

    test('it relays a failure message to the dependabot service', async () => {
      await run(context)

      expect(reportJobErrorSpy).toHaveBeenCalledWith({
        'error-type': 'actions_workflow_unknown',
        'error-details': {
          'action-error': 'error getting credentials'
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

  describe('when there is an error running the update', () => {
    beforeEach(() => {
      jest
        .spyOn(Updater.prototype, 'runUpdater')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error running the update'))
          )
        )

      context = new Context()
    })

    test('it fails the workflow', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error running the update')
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
