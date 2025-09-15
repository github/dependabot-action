import {Context} from '@actions/github/lib/context'
import {getJobParameters} from '../src/inputs'
import {eventFixturePath} from './helpers'

let context: Context

describe('when there is a fully configured Actions environment', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    context = new Context()
  })

  test('loads inputs from a dynamic event', () => {
    const params = getJobParameters(context)

    expect(params?.jobId).toEqual(1)
    expect(params?.jobToken).toEqual('xxx')
    expect(params?.credentialsToken).toEqual('yyy')
    expect(params?.dependabotApiUrl).toEqual('http://localhost:9000')
    expect(params?.dependabotApiDockerUrl).toEqual('http://localhost:9000')
  })
})

describe('when there is no GITHUB_EVENT_NAME defined', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    delete process.env.GITHUB_EVENT_NAME
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    context = new Context()
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('Required Actions environment variables missing.')
  })
})

describe('when the GITHUB_EVENT_NAME is not "dynamic"', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'issue_comment'
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    context = new Context()
  })

  test('it returns null', () => {
    const params = getJobParameters(context)

    expect(params).toEqual(null)
  })
})

describe('when there is no GITHUB_ACTOR defined', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    delete process.env.GITHUB_ACTOR
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    context = new Context()
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('Required Actions environment variables missing.')
  })
})

describe('when the GITHUB_ACTOR is not "dependabot[bot]"', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'classic-rando'
    process.env.GITHUB_TRIGGERING_ACTOR = 'classic-rando'

    context = new Context()
  })

  test('it returns null', () => {
    const params = getJobParameters(context)

    expect(params).toEqual(null)
  })
})

describe('when there is no GITHUB_TRIGGERING_ACTOR defined', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    delete process.env.GITHUB_TRIGGERING_ACTOR

    context = new Context()
  })

  test('it returns a result', () => {
    expect(() => {
      getJobParameters(context)
    }).toBeTruthy()
  })
})

describe('when the GITHUB_TRIGGERING_ACTOR is not "dependabot[bot]"', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_TRIGGERING_ACTOR = 'classic-rando'

    context = new Context()
  })

  test('it returns null', () => {
    const params = getJobParameters(context)

    expect(params).toEqual(null)
  })
})

describe('when the event inputs are empty', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('no_inputs')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_TRIGGERING_ACTOR = 'dependabot[bot]'

    context = new Context()
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('Event payload has no inputs')
  })
})
