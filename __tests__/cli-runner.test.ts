import * as core from '@actions/core'
import * as httpClient from '@actions/http-client'
import * as child_process from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import {Credential, JobDetails} from '../src/api-client'
import {
  buildJobFile,
  runCLI,
  runDependabotCLI,
  CLIJobFile,
  getPlatformName,
  getArchName,
  getDownloadUrl,
  resolveVersion
} from '../src/cli-runner'

jest.mock('@actions/core')
jest.mock('@actions/http-client')
jest.mock('child_process')

describe('cli-runner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(core, 'info').mockImplementation(jest.fn())
    jest.spyOn(core, 'warning').mockImplementation(jest.fn())
    jest.spyOn(core, 'startGroup').mockImplementation(jest.fn())
    jest.spyOn(core, 'endGroup').mockImplementation(jest.fn())
  })

  describe('getPlatformName', () => {
    test('maps linux correctly', () => {
      expect(getPlatformName('linux')).toBe('linux')
    })

    test('maps darwin correctly', () => {
      expect(getPlatformName('darwin')).toBe('darwin')
    })

    test('maps win32 to windows', () => {
      expect(getPlatformName('win32')).toBe('windows')
    })

    test('throws for unsupported platform', () => {
      expect(() => getPlatformName('freebsd')).toThrow(
        'Unsupported platform: freebsd'
      )
    })
  })

  describe('getArchName', () => {
    test('maps x64 to amd64', () => {
      expect(getArchName('x64')).toBe('amd64')
    })

    test('maps arm64 correctly', () => {
      expect(getArchName('arm64')).toBe('arm64')
    })

    test('throws for unsupported architecture', () => {
      expect(() => getArchName('s390x')).toThrow(
        'Unsupported architecture: s390x'
      )
    })
  })

  describe('getDownloadUrl', () => {
    test('generates versioned URL correctly', () => {
      const url = getDownloadUrl('v1.90.0', 'linux', 'amd64')
      expect(url).toBe(
        'https://github.com/dependabot/cli/releases/download/v1.90.0/dependabot-v1.90.0-linux-amd64.tar.gz'
      )
    })

    test('generates versioned URL for darwin arm64', () => {
      const url = getDownloadUrl('v1.2.3', 'darwin', 'arm64')
      expect(url).toBe(
        'https://github.com/dependabot/cli/releases/download/v1.2.3/dependabot-v1.2.3-darwin-arm64.tar.gz'
      )
    })
  })

  describe('resolveVersion', () => {
    const httpClientMock = httpClient.HttpClient as unknown as jest.Mock

    test('returns the version as-is when not latest', async () => {
      const result = await resolveVersion('v1.90.0')
      expect(result).toBe('v1.90.0')
    })

    test('fetches latest tag from GitHub API when version is latest', async () => {
      const mockGetJson = jest.fn().mockResolvedValue({
        result: {tag_name: 'v1.90.0'}
      })
      httpClientMock.mockImplementation(() => ({
        getJson: mockGetJson
      }))

      const result = await resolveVersion('latest')
      expect(result).toBe('v1.90.0')
      expect(mockGetJson).toHaveBeenCalledWith(
        'https://api.github.com/repos/dependabot/cli/releases/latest'
      )
    })

    test('throws when API returns no tag_name', async () => {
      httpClientMock.mockImplementation(() => ({
        getJson: jest.fn().mockResolvedValue({result: null})
      }))

      await expect(resolveVersion('latest')).rejects.toThrow(
        'Failed to resolve latest CLI version'
      )
    })

    test('uses the provided token when resolving latest version', async () => {
      const mockGetJson = jest.fn().mockResolvedValue({
        result: {tag_name: 'v1.90.0'}
      })

      httpClientMock.mockImplementation(() => ({
        getJson: mockGetJson
      }))

      await resolveVersion('latest', 'ghs_test_token')

      expect(httpClient.HttpClient).toHaveBeenCalledTimes(1)
      const clientCall = httpClientMock.mock.calls[0]
      expect(clientCall[0]).toBe('dependabot-action')
      expect(Array.isArray(clientCall[1])).toBe(true)
      expect(clientCall[1][0]).toMatchObject({token: 'ghs_test_token'})
    })
  })

  describe('buildJobFile', () => {
    const baseDetails: JobDetails = {
      id: '123',
      'package-manager': 'npm_and_yarn',
      'allowed-updates': [{'dependency-type': 'direct'}],
      'credentials-metadata': [],
      experiments: {'some-experiment': true},
      source: {repo: 'owner/repo'}
    }

    const baseCredentials: Credential[] = [
      {
        type: 'git_source',
        host: 'github.com',
        username: 'x-access-token',
        password: 'ghp_token123'
      }
    ]

    test('creates a valid YAML job file', () => {
      const filePath = buildJobFile(baseDetails, baseCredentials)

      expect(fs.existsSync(filePath)).toBe(true)

      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      expect(parsed.job['package-manager']).toBe('npm_and_yarn')
      const source = parsed.job.source as Record<string, unknown>
      expect(source.provider).toBe('github')
      expect(source.repo).toBe('owner/repo')
      expect(parsed.job['allowed-updates']).toEqual([
        {'dependency-type': 'direct'}
      ])
      expect(parsed.credentials).toHaveLength(1)
      const credentials = parsed.credentials || []
      expect(credentials[0].type).toBe('git_source')
      expect(credentials[0].host).toBe('github.com')

      // Clean up
      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('produces the expected raw YAML output', () => {
      const filePath = buildJobFile(baseDetails, baseCredentials)
      const content = fs.readFileSync(filePath, 'utf8')

      const expectedYaml = [
        'job:',
        '  package-manager: npm_and_yarn',
        '  allowed-updates:',
        '    - dependency-type: direct',
        '  credentials-metadata: []',
        '  experiments:',
        '    some-experiment: true',
        '  source:',
        '    provider: github',
        '    repo: owner/repo',
        'credentials:',
        '  - type: git_source',
        '    host: github.com',
        '    username: x-access-token',
        '    password: ghp_token123',
        ''
      ].join('\n')

      expect(content).toBe(expectedYaml)

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('passes through all job fields from details', () => {
      // Simulate a realistic job with many extra fields beyond the TypeScript type
      const fullDetails = {
        ...baseDetails,
        command: 'update',
        'commit-message-options': {prefix: null},
        debug: null,
        dependencies: ['express', 'lodash'],
        'dependency-groups': [
          {name: 'prod', rules: {'dependency-type': 'production'}}
        ],
        'ignore-conditions': [],
        'lockfile-only': false,
        'max-updater-run-time': 2700,
        'reject-external-code': false,
        'security-advisories': [],
        'security-updates-only': false,
        'updating-a-pull-request': false,
        'repo-private': false
      } as unknown as JobDetails

      const filePath = buildJobFile(fullDetails, [])
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      // All fields should be passed through
      expect(parsed.job.command).toBe('update')
      expect(parsed.job.dependencies).toEqual(['express', 'lodash'])
      expect(parsed.job['max-updater-run-time']).toBe(2700)
      expect(parsed.job['lockfile-only']).toBe(false)
      expect(parsed.job['security-updates-only']).toBe(false)
      expect(parsed.job['reject-external-code']).toBe(false)
      expect(parsed.job['repo-private']).toBe(false)
      expect(parsed.job['dependency-groups']).toEqual([
        {name: 'prod', rules: {'dependency-type': 'production'}}
      ])

      // id should be stripped (internal field)
      expect(parsed.job.id).toBeUndefined()

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('sets source.provider to github without overwriting other source fields', () => {
      const detailsWithFullSource = {
        ...baseDetails,
        source: {
          repo: 'org/repo',
          branch: 'main',
          hostname: 'github.com',
          'api-endpoint': 'https://api.github.com/',
          directories: ['/', '/packages']
        }
      } as unknown as JobDetails

      const filePath = buildJobFile(detailsWithFullSource, [])
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile
      const source = parsed.job.source as Record<string, unknown>

      expect(source.provider).toBe('github')
      expect(source.repo).toBe('org/repo')
      expect(source.branch).toBe('main')
      expect(source.hostname).toBe('github.com')
      expect(source['api-endpoint']).toBe('https://api.github.com/')
      expect(source.directories).toEqual(['/', '/packages'])

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('includes experiments in job file', () => {
      const filePath = buildJobFile(baseDetails, baseCredentials)
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      expect(parsed.job.experiments).toEqual({'some-experiment': true})

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('omits credentials section when empty', () => {
      const filePath = buildJobFile(baseDetails, [])
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      expect(parsed.credentials).toEqual([])

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('omits undefined credential fields', () => {
      const creds: Credential[] = [
        {type: 'npm_registry', registry: 'npm.pkg.github.com'}
      ]
      const filePath = buildJobFile(baseDetails, creds)
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      const credentials = parsed.credentials || []

      expect(credentials[0]).toEqual({
        type: 'npm_registry',
        registry: 'npm.pkg.github.com'
      })
      expect(credentials[0]).not.toHaveProperty('password')
      expect(credentials[0]).not.toHaveProperty('token')

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('passes through empty experiments as-is', () => {
      const detailsNoExperiments = {
        ...baseDetails,
        experiments: {}
      }
      const filePath = buildJobFile(detailsNoExperiments, baseCredentials)
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      expect(parsed.job.experiments).toEqual({})

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('keeps secret fields in credentials', () => {
      const creds: Credential[] = [
        {
          type: 'git_source',
          host: 'github.com',
          username: 'x-access-token',
          password: 'ghp_secret',
          token: 'tok_secret'
        }
      ]
      const filePath = buildJobFile(baseDetails, creds)
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      const credentials = parsed.credentials || []

      expect(credentials[0]).toEqual({
        type: 'git_source',
        host: 'github.com',
        username: 'x-access-token',
        password: 'ghp_secret',
        token: 'tok_secret'
      })

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })

    test('keeps jit_access credentials', () => {
      const creds: Credential[] = [
        {type: 'jit_access', host: 'github.com', token: 'tok'},
        {type: 'git_source', host: 'github.com'}
      ]
      const filePath = buildJobFile(baseDetails, creds)
      const content = fs.readFileSync(filePath, 'utf8')
      const parsed = yaml.load(content) as CLIJobFile

      expect(parsed.credentials).toHaveLength(2)
      const credentials = parsed.credentials || []
      expect(credentials[0].type).toBe('jit_access')
      expect(credentials[1].type).toBe('git_source')

      fs.rmSync(path.dirname(filePath), {recursive: true, force: true})
    })
  })

  describe('runCLI', () => {
    test('spawns binary with correct arguments', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml')

      expect(child_process.spawn).toHaveBeenCalledWith(
        '/usr/local/bin/dependabot',
        ['update', '-f', '/tmp/job.yaml'],
        expect.objectContaining({stdio: 'pipe'})
      )
    })

    test('includes output path when provided', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml', {
        outputPath: '/tmp/output.yaml'
      })

      expect(child_process.spawn).toHaveBeenCalledWith(
        '/usr/local/bin/dependabot',
        ['update', '-f', '/tmp/job.yaml', '-o', '/tmp/output.yaml'],
        expect.objectContaining({stdio: 'pipe'})
      )
    })

    test('throws on non-zero exit code', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(1))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await expect(
        runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml')
      ).rejects.toThrow('dependabot CLI exited with code 1')
    })

    test('succeeds on zero exit code', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await expect(
        runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml')
      ).resolves.toBeUndefined()
    })

    test('merges extraEnv into spawn environment', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml', {
        extraEnv: {
          LOCAL_GITHUB_ACCESS_TOKEN: 'ghp_test123',
          DEPENDABOT_JOB_ID: '42',
          JOB_TOKEN: 'test-job-token'
        }
      })

      const spawnCall = (child_process.spawn as jest.Mock).mock.calls[0]
      const env = spawnCall[2].env
      expect(env.LOCAL_GITHUB_ACCESS_TOKEN).toBe('ghp_test123')
      expect(env.DEPENDABOT_JOB_ID).toBe('42')
      expect(env.JOB_TOKEN).toBe('test-job-token')
    })

    test('includes api-url flag when apiUrl is provided', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml', {
        outputPath: '/tmp/output.yaml',
        apiUrl: 'https://api.dependabot.com'
      })

      expect(child_process.spawn).toHaveBeenCalledWith(
        '/usr/local/bin/dependabot',
        [
          'update',
          '-f',
          '/tmp/job.yaml',
          '-o',
          '/tmp/output.yaml',
          '--api-url',
          'https://api.dependabot.com'
        ],
        expect.objectContaining({stdio: 'pipe'})
      )
    })

    test('includes updater-image and proxy-image flags when provided', async () => {
      const mockProc = {
        stdout: {on: jest.fn()},
        stderr: {on: jest.fn()},
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') {
            setImmediate(() => cb(0))
          }
        })
      }
      jest.spyOn(child_process, 'spawn').mockReturnValue(mockProc as any)

      await runCLI('/usr/local/bin/dependabot', '/tmp/job.yaml', {
        updaterImage: 'ghcr.io/dependabot/dependabot-updater-npm:v1.0.0',
        proxyImage: 'ghcr.io/dependabot/proxy:v1.0.0'
      })

      expect(child_process.spawn).toHaveBeenCalledWith(
        '/usr/local/bin/dependabot',
        [
          'update',
          '-f',
          '/tmp/job.yaml',
          '--updater-image',
          'ghcr.io/dependabot/dependabot-updater-npm:v1.0.0',
          '--proxy-image',
          'ghcr.io/dependabot/proxy:v1.0.0'
        ],
        expect.objectContaining({stdio: 'pipe'})
      )
    })
  })

  describe('runDependabotCLI', () => {
    // The orchestrator function is tested via main.test.ts which mocks
    // the entire cli-runner module. Here we just verify it's exported correctly.
    test('is an async function', () => {
      expect(typeof runDependabotCLI).toBe('function')
    })
  })
})
