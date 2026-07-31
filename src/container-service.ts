import * as core from '@actions/core'
import * as fs from 'fs'
import {Container} from 'dockerode'
import {pack, extract} from 'tar-stream'
import {FileFetcherInput, FileUpdaterInput, ProxyConfig} from './config-types'
import {outStream, errStream} from './utils'

export class ContainerRuntimeError extends Error {}

const RWX_ALL = 0o777

const OUTPUT_PATH = '/home/dependabot/dependabot-updater/output'
const OUTPUT_FILE_PATH = `${OUTPUT_PATH}/output.json`
const SUMMARY_FILE_PATH = `${OUTPUT_PATH}/summary.md`

// 'fetch' clones the repo and writes the handoff artifact, 'update' runs the
// package manager against that artifact. 'all' runs both in one container,
// which is the legacy UPDATER_ONE_CONTAINER behaviour.
export type UpdaterPhase = 'fetch' | 'update' | 'all'

export const ContainerService = {
  async storeInput(
    name: string,
    path: string,
    container: Container,
    input: FileFetcherInput | FileUpdaterInput | ProxyConfig
  ): Promise<void> {
    const tar = pack()
    tar.entry({name, mode: RWX_ALL}, JSON.stringify(input))
    tar.finalize()
    await container.putArchive(tar, {path})
  },

  async storeCert(
    name: string,
    path: string,
    container: Container,
    cert: string
  ): Promise<void> {
    const tar = pack()
    tar.entry({name}, cert)
    tar.finalize()
    await container.putArchive(tar, {path})
  },

  async run(container: Container, command?: string): Promise<boolean> {
    await this.runPhase(container, 'all', command)
    return true
  },

  /**
   * Run the fetch phase and return the raw contents of the handoff artifact
   * written by the fetcher, or undefined if it produced no output.
   */
  async runFileFetcher(container: Container): Promise<string | undefined> {
    return await this.runPhase(container, 'fetch')
  },

  async runFileUpdater(container: Container, command?: string): Promise<void> {
    await this.runPhase(container, 'update', command)
  },

  updaterCommands(phase: UpdaterPhase, command?: string): string[] {
    const commands = [`mkdir -p ${OUTPUT_PATH}`]

    if (phase === 'all' || phase === 'fetch') {
      commands.push('$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files')
    }

    if (phase === 'all' || phase === 'update') {
      commands.push(
        command === 'graph'
          ? '$DEPENDABOT_HOME/dependabot-updater/bin/run update_graph'
          : '$DEPENDABOT_HOME/dependabot-updater/bin/run update_files'
      )
    }

    return commands
  },

  async runPhase(
    container: Container,
    phase: UpdaterPhase,
    command?: string
  ): Promise<string | undefined> {
    try {
      // Start the container
      await container.start()
      core.info(`Started container ${container.id}`)

      // Check if this is a dependabot container (has the expected structure)
      const containerInfo = await container.inspect()
      const isDependabotContainer = containerInfo.Config?.Env?.some(env =>
        env.startsWith('DEPENDABOT_JOB_ID=')
      )

      if (!isDependabotContainer) {
        // For test containers and other containers, just wait for completion
        const outcome = await container.wait()
        if (outcome.StatusCode !== 0) {
          throw new Error(`Container exited with code ${outcome.StatusCode}`)
        }
        return undefined
      }

      // For dependabot containers, run CA certificates update as root first
      await this.execCommand(
        container,
        ['/usr/sbin/update-ca-certificates'],
        'root'
      )

      // Then run the dependabot commands as dependabot user
      for (const cmd of this.updaterCommands(phase, command)) {
        await this.execCommand(container, ['/bin/sh', '-c', cmd], 'dependabot')
      }

      if (phase === 'fetch') {
        // The fetch phase hands its file subset off to the update container, so
        // read it out before this container is torn down.
        return await this.readFile(container, OUTPUT_FILE_PATH)
      }

      // Extract job summary only after all commands have succeeded.
      // This prevents malicious code executed during fetch_files from
      // injecting content — our updater overwrites the file at the end
      // of a successful run.
      await this.extractJobSummary(container)

      return undefined
    } catch (error) {
      core.info(`Failure running container ${container.id}: ${error}`)
      throw new ContainerRuntimeError(
        'The updater encountered one or more errors.'
      )
    } finally {
      try {
        await container.remove({v: true, force: true})
        core.info(`Cleaned up container ${container.id}`)
      } catch (error) {
        core.info(`Failed to clean up container ${container.id}: ${error}`)
      }
    }
  },

  async execCommand(
    container: Container,
    cmd: string[],
    user: string
  ): Promise<void> {
    const exec = await container.exec({
      Cmd: cmd,
      User: user,
      AttachStdout: true,
      AttachStderr: true
    })

    const stream = await exec.start({})

    // Wait for the stream to end
    await new Promise<void>((resolve, reject) => {
      container.modem.demuxStream(
        stream,
        outStream('updater'),
        errStream('updater')
      )

      stream.on('end', () => {
        resolve()
      })

      stream.on('error', error => {
        reject(error)
      })
    })

    // Wait a bit for the exec to complete properly
    await new Promise(resolve => setTimeout(resolve, 100))

    const inspection = await exec.inspect()
    if (inspection.ExitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${inspection.ExitCode}: ${cmd.join(' ')}`
      )
    }
  },

  async readFile(
    container: Container,
    path: string
  ): Promise<string | undefined> {
    try {
      const archiveStream = await container.getArchive({path})

      return await new Promise<string>((resolve, reject) => {
        const extractor = extract()
        let data = ''

        extractor.on('entry', (header, stream, next) => {
          stream.on('data', chunk => {
            data += chunk.toString()
          })
          stream.on('end', () => next())
          stream.resume()
        })

        extractor.on('finish', () => resolve(data))
        extractor.on('error', err => reject(err))

        archiveStream.pipe(extractor)
      })
    } catch {
      core.debug(`No file found in container at ${path}`)
      return undefined
    }
  },

  async extractJobSummary(container: Container): Promise<void> {
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY

    if (!stepSummaryPath) {
      return
    }

    const content = await this.readFile(container, SUMMARY_FILE_PATH)

    if (content && content.length > 0) {
      fs.appendFileSync(stepSummaryPath, content)
      core.info('Job summary written to GITHUB_STEP_SUMMARY')
    }
  }
}
