import * as core from '@actions/core'
import * as httpClient from '@actions/http-client'
import {BearerCredentialHandler} from '@actions/http-client/lib/auth'
import {spawn} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import {ApiClient, Credential, JobDetails} from './api-client'

const CLI_REPO = 'dependabot/cli'

function getGitHubHttpClient(token?: string): httpClient.HttpClient {
  if (!token) {
    return new httpClient.HttpClient('dependabot-action')
  }

  return new httpClient.HttpClient('dependabot-action', [
    new BearerCredentialHandler(token)
  ])
}

export interface CLIJobFile {
  job: Record<string, unknown>
  credentials?: Array<Record<string, unknown>>
  'credentials-metadata'?: Array<Record<string, unknown>>
}

/**
 * Downloads the dependabot CLI binary from GitHub Releases.
 * Downloads the tarball, extracts it using tar, and returns the binary path.
 */
export async function downloadCLI(version?: string): Promise<string> {
  const githubToken = process.env.GITHUB_TOKEN
  const resolvedVersion = await resolveVersion(version || 'latest', githubToken)
  const platform = os.platform()
  const arch = os.arch()

  const platformName = getPlatformName(platform)
  const archName = getArchName(arch)

  const downloadUrl = getDownloadUrl(resolvedVersion, platformName, archName)
  core.info(`Downloading dependabot CLI from: ${downloadUrl}`)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-dl-'))
  const tarballPath = path.join(tmpDir, 'dependabot.tar.gz')

  const client = getGitHubHttpClient(githubToken)
  const response = await client.get(downloadUrl)

  if (response.message.statusCode !== 200) {
    // Follow redirect for GitHub releases
    const location = response.message.headers.location
    if (location) {
      const redirectResponse = await client.get(location)
      if (
        redirectResponse.message.statusCode !== undefined &&
        redirectResponse.message.statusCode >= 400
      ) {
        throw new Error(
          `Failed to download CLI: HTTP ${redirectResponse.message.statusCode}`
        )
      }
      await writeStreamToFile(redirectResponse, tarballPath)
    } else if (
      response.message.statusCode !== undefined &&
      response.message.statusCode >= 400
    ) {
      throw new Error(
        `Failed to download CLI: HTTP ${response.message.statusCode}`
      )
    } else {
      await writeStreamToFile(response, tarballPath)
    }
  } else {
    await writeStreamToFile(response, tarballPath)
  }

  const extractDir = path.join(tmpDir, 'extracted')
  fs.mkdirSync(extractDir, {recursive: true})

  await extractTar(tarballPath, extractDir)

  const binaryName = platform === 'win32' ? 'dependabot.exe' : 'dependabot'
  const binaryPath = path.join(extractDir, binaryName)

  if (!fs.existsSync(binaryPath)) {
    const contents = fs.readdirSync(extractDir).join(', ')
    throw new Error(
      `CLI binary not found at expected path: ${binaryPath}. Contents: ${contents}`
    )
  }

  fs.chmodSync(binaryPath, 0o755)
  core.info(`dependabot CLI available at: ${binaryPath}`)
  return binaryPath
}

/**
 * Builds a YAML job definition file from JobDetails and Credentials.
 * Passes through all job fields from the API response to ensure
 * the CLI has the complete job definition.
 * Returns the path to the temporary YAML file.
 */
export function buildJobFile(
  details: JobDetails,
  credentials: Credential[]
): string {
  // Spread all fields from details into the job, ensuring source.provider is set
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {id, ...jobFields} = details as Record<string, unknown>
  const source = (jobFields.source as Record<string, unknown>) || {}
  jobFields.source = {provider: 'github', ...source}

  const jobFile: CLIJobFile = {
    job: jobFields,
    credentials
  }

  const yamlContent = yaml.dump(jobFile, {
    lineWidth: -1,
    noRefs: true
  })

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-cli-'))
  const jobFilePath = path.join(tmpDir, 'job.yaml')
  fs.writeFileSync(jobFilePath, yamlContent, 'utf8')

  core.info(`Job file written to: ${jobFilePath}`)
  return jobFilePath
}

/**
 * Runs the dependabot CLI binary with the given job file.
 */
export interface CLIRunOptions {
  outputPath?: string
  apiUrl?: string
  updaterImage?: string
  proxyImage?: string
  extraEnv?: Record<string, string>
}

export async function runCLI(
  binaryPath: string,
  jobFilePath: string,
  options: CLIRunOptions = {}
): Promise<void> {
  const args = ['update', '-f', jobFilePath]

  if (options.outputPath) {
    args.push('-o', options.outputPath)
  }

  if (options.apiUrl) {
    args.push('--api-url', options.apiUrl)
  }

  if (options.updaterImage) {
    args.push('--updater-image', options.updaterImage)
  }

  if (options.proxyImage) {
    args.push('--proxy-image', options.proxyImage)
  }

  core.info(`Running: ${binaryPath} ${args.join(' ')}`)

  const exitCode = await spawnProcess(binaryPath, args, options.extraEnv)

  if (exitCode !== 0) {
    throw new Error(`dependabot CLI exited with code ${exitCode}`)
  }
}

/**
 * Top-level orchestrator: downloads CLI, builds job file, runs CLI, cleans up.
 */
export async function runDependabotCLI(
  details: JobDetails,
  credentials: Credential[],
  apiClient: ApiClient,
  updaterImage?: string,
  proxyImage?: string
): Promise<void> {
  let cliTmpDir: string | undefined
  let jobFilePath: string | undefined
  let outputDir: string | undefined

  try {
    core.startGroup('Downloading dependabot CLI')
    const binaryPath = await downloadCLI()
    cliTmpDir = path.dirname(path.dirname(binaryPath))
    core.endGroup()

    core.startGroup('Building job definition')
    jobFilePath = buildJobFile(details, credentials)
    core.endGroup()

    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-output-'))
    const outputPath = path.join(outputDir, 'output.yaml')

    core.startGroup('Running dependabot CLI')
    const experiments = (details.experiments as Record<string, unknown>) || {}
    const cachedMode = Object.prototype.hasOwnProperty.call(
      experiments,
      'proxy-cached'
    )
    const extraEnv: Record<string, string> = {
      DEPENDABOT_JOB_ID: String(apiClient.params.jobId),
      JOB_TOKEN: apiClient.getJobToken(),
      PROXY_CACHE: cachedMode ? 'true' : 'false',
      ...(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== undefined
        ? {
            ACTIONS_ID_TOKEN_REQUEST_TOKEN:
              process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
          }
        : {}),
      ...(process.env.ACTIONS_ID_TOKEN_REQUEST_URL !== undefined
        ? {
            ACTIONS_ID_TOKEN_REQUEST_URL:
              process.env.ACTIONS_ID_TOKEN_REQUEST_URL
          }
        : {}),
      // Pass through OPENSSL_FORCE_FIPS_MODE from the host if set.
      // The container does not have the OpenSSL FIPS provider installed, so OpenSSL fails while running update-ca-certificates on FIPS-enabled self-hosted runners.
      // Setting OPENSSL_FORCE_FIPS_MODE=0 on the host works around this by explicitly preventing OpenSSL from using FIPS.
      // We only propagate the env variable when it is explicitly set so as not to alter default behavior.
      ...(process.env.OPENSSL_FORCE_FIPS_MODE !== undefined
        ? {OPENSSL_FORCE_FIPS_MODE: process.env.OPENSSL_FORCE_FIPS_MODE}
        : {})
    }
    const githubToken = process.env.GITHUB_TOKEN
    if (githubToken) {
      extraEnv.LOCAL_GITHUB_ACCESS_TOKEN = githubToken
    }
    await runCLI(binaryPath, jobFilePath, {
      outputPath,
      apiUrl: apiClient.params.dependabotApiUrl,
      updaterImage,
      proxyImage,
      extraEnv
    })
    core.endGroup()

    await apiClient.markJobAsProcessed()
  } finally {
    // Clean up temp files
    if (cliTmpDir) {
      fs.rmSync(cliTmpDir, {recursive: true, force: true})
    }
    if (jobFilePath) {
      const jobDir = path.dirname(jobFilePath)
      fs.rmSync(jobDir, {recursive: true, force: true})
    }
    if (outputDir) {
      fs.rmSync(outputDir, {recursive: true, force: true})
    }
  }
}

export function getPlatformName(platform: string): string {
  switch (platform) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'windows'
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

export function getArchName(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'amd64'
    case 'arm64':
      return 'arm64'
    default:
      throw new Error(`Unsupported architecture: ${arch}`)
  }
}

export async function resolveVersion(
  version: string,
  githubToken?: string
): Promise<string> {
  if (version !== 'latest') {
    return version
  }
  const client = getGitHubHttpClient(githubToken)
  const res = await client.getJson<{tag_name: string}>(
    `https://api.github.com/repos/${CLI_REPO}/releases/latest`
  )
  if (!res.result?.tag_name) {
    throw new Error('Failed to resolve latest CLI version')
  }
  return res.result.tag_name
}

export function getDownloadUrl(
  version: string,
  platform: string,
  arch: string
): string {
  return `https://github.com/${CLI_REPO}/releases/download/${version}/dependabot-${version}-${platform}-${arch}.tar.gz`
}

async function writeStreamToFile(
  response: httpClient.HttpClientResponse,
  filePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settleReject = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }

    const settleResolve = (): void => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    const fileStream = fs.createWriteStream(filePath)
    response.message.on('error', settleReject)
    response.message.pipe(fileStream)
    fileStream.on('finish', settleResolve)
    fileStream.on('error', settleReject)
  })
}

async function extractTar(tarballPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['xzf', tarballPath, '-C', destDir], {
      stdio: 'pipe'
    })
    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`tar extraction failed with exit code ${code}`))
      }
    })
    proc.on('error', error => {
      reject(
        new Error(
          `Failed to extract CLI tarball: ${error.message}. Ensure 'tar' is installed and available on PATH.`
        )
      )
    })
  })
}

async function spawnProcess(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>
): Promise<number> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...extraEnv
    }

    const proc = spawn(command, args, {stdio: 'pipe', env})

    proc.stdout?.on('data', (data: Buffer) => {
      core.info(data.toString().trimEnd())
    })

    proc.stderr?.on('data', (data: Buffer) => {
      core.info(data.toString().trimEnd())
    })

    proc.on('close', code => {
      resolve(code ?? 1)
    })

    proc.on('error', reject)
  })
}
