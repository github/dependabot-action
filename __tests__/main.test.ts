import * as core from '@actions/core'
import {Context} from '@actions/github/lib/context'
import {APIClient} from '../src/api-client'
import {Updater} from '../src/updater'
import * as inputs from '../src/inputs'
import {run} from '../src/main'

import {eventFixturePath} from './helpers'

// We do not need to build actual containers or run updates for this test.
jest.mock('../src/api-client')
jest.mock('../src/image-service')
jest.mock('../src/updater')

describe('run', () => {
  let context: Context

  beforeEach(async () => {
    jest.spyOn(core, 'info').mockImplementation(jest.fn())
    jest.spyOn(core, 'setFailed').mockImplementation(jest.fn())
  })

  afterEach(async () => {
    jest.clearAllMocks() // Reset any mocked classes
  })

  describe('when the run follows the happy path', () => {
    beforeAll(() => {
      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
      context = new Context()
    })

    test('it signs off at completion without any errors', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🤖 ~fin~')
      )
    })
  })

  describe('when the action is triggered on an unsupported event', () => {
    beforeAll(() => {
      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'issue_created'
      context = new Context()
    })

    test('it explains the event is unsupported without logging to dependabot-api', async () => {
      await run(context)

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "Dependabot Updater Action does not support 'issue_created' events."
        )
      )
    })
  })

  describe('when there is an error retrieving job parameters', () => {
    beforeEach(() => {
      jest.spyOn(inputs, 'getJobParameters').mockImplementationOnce(
        jest.fn(() => {
          throw new Error('unexpected error retrieving job params')
        })
      )

      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
      context = new Context()
    })

    test('it relays an error to dependabot-api and marks the job as processed', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('unexpected error retrieving job params')
      )
    })
  })

  describe('when there is an error retrieving job details from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(APIClient.prototype, 'getJobDetails')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error getting job details'))
          )
        )

      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
      context = new Context()
    })

    test('it relays an error to dependabot-api and marks the job as processed', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error getting job details')
      )
    })
  })

  describe('when there is an error retrieving job credentials from DependabotAPI', () => {
    beforeEach(() => {
      jest
        .spyOn(APIClient.prototype, 'getCredentials')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error getting credentials'))
          )
        )

      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
      context = new Context()
    })

    test('it relays an error to dependabot-api and marks the job as processed', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error getting credentials')
      )
    })
  })

  describe('when there is an error running the update', () => {
    beforeAll(() => {
      jest
        .spyOn(Updater.prototype, 'runUpdater')
        .mockImplementationOnce(
          jest.fn(async () =>
            Promise.reject(new Error('error running the update'))
          )
        )

      process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
      process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
      context = new Context()
    })

    test('it relays an error to dependabot-api and marks the job as processed', async () => {
      await run(context)

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('error running the update')
      )
    })
  })
})
