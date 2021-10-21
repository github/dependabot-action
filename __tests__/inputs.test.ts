import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {Context} from '@actions/github/lib/context'
import {getJobParameters} from '../src/inputs'
import {eventFixturePath} from './helpers'

let context: Context
const workspace = path.join(__dirname, '..', 'tmp')
const workingDirectory = path.join(workspace, './test_working_directory')

beforeEach(() => {
  fs.mkdirSync(workingDirectory)
})

afterEach(() => {
  if (fs.existsSync(workingDirectory)) {
    fs.rmdirSync(workingDirectory)
  }
})

describe('when there is a fully configured Actions environment', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

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

  test('it returns an absolute path based on GITHUB_WORKSPACE and the workingDirectory input', () => {
    const params = getJobParameters(context)

    expect(params?.workingDirectory).toEqual(workingDirectory)
  })
})

describe('when there is no GITHUB_EVENT_NAME defined', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    delete process.env.GITHUB_EVENT_NAME
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

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
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

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
    process.env.GITHUB_WORKSPACE = workspace

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
    process.env.GITHUB_WORKSPACE = workspace

    context = new Context()
  })

  test('it returns null', () => {
    const params = getJobParameters(context)

    expect(params).toEqual(null)
  })
})

describe('when there is no GITHUB_WORKSPACE defined', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    delete process.env.GITHUB_WORKSPACE

    context = new Context()
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('Required Actions environment variables missing.')
  })
})

describe('when the GITHUB_WORKSPACE path does not exist', () => {
  beforeEach(() => {
    const randomFolderName = crypto.randomBytes(16).toString('hex')

    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = path.join(workspace, randomFolderName)

    context = new Context()
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('The GITHUB_WORKSPACE directory does not exist.')
  })
})

describe('when the GITHUB_WORKSPACE exists, but is a file', () => {
  const randomFileName = path.join(
    workspace,
    crypto.randomBytes(16).toString('hex')
  )

  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = randomFileName

    fs.closeSync(fs.openSync(randomFileName, 'w'))

    context = new Context()
  })

  afterEach(() => {
    fs.unlinkSync(randomFileName)
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('The GITHUB_WORKSPACE directory does not exist.')
  })
})

describe('when the workingDirectory is a blank value', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('blank_working_directory')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

    context = new Context()

    fs.rmdirSync(workingDirectory)
    fs.closeSync(fs.openSync(workingDirectory, 'w'))
  })

  afterEach(() => {
    fs.unlinkSync(workingDirectory)
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('The workingDirectory input must not be blank')
  })
})

describe('when the workingDirectory does not exist', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

    context = new Context()

    fs.rmdirSync(workingDirectory)
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow(
      `The workingDirectory './test_working_directory' does not exist in GITHUB_WORKSPACE`
    )
  })
})

describe('when the workingDirectory exists, but is a file', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('default')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

    context = new Context()

    fs.rmdirSync(workingDirectory)
    fs.closeSync(fs.openSync(workingDirectory, 'w'))
  })

  afterEach(() => {
    fs.unlinkSync(workingDirectory)
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow(
      `The workingDirectory './test_working_directory' does not exist in GITHUB_WORKSPACE`
    )
  })
})

describe('when the event inputs are empty', () => {
  beforeEach(() => {
    process.env.GITHUB_EVENT_PATH = eventFixturePath('no_inputs')
    process.env.GITHUB_EVENT_NAME = 'dynamic'
    process.env.GITHUB_ACTOR = 'dependabot[bot]'
    process.env.GITHUB_WORKSPACE = workspace

    context = new Context()

    fs.rmdirSync(workingDirectory)
  })

  test('it throws an error', () => {
    expect(() => {
      getJobParameters(context)
    }).toThrow('Event payload has no inputs')
  })
})
