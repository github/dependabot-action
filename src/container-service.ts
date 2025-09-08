import * as core from '@actions/core'
import {Container} from 'dockerode'
import {pack} from 'tar-stream'
import {FileFetcherInput, FileUpdaterInput, ProxyConfig} from './config-types'
import {outStream, errStream} from './utils'

export class ContainerRuntimeError extends Error {}

const RWX_ALL = 0o777

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

  async run(container: Container): Promise<boolean> {
    try {
      // Start the container
      await container.start()
      core.info(`Started container ${container.id}`)

      // Check if this is a dependabot container (has the expected structure)
      const containerInfo = await container.inspect()
      const isDependabotContainer = containerInfo.Config?.Env?.some(env =>
        env.startsWith('DEPENDABOT_JOB_ID=')
      )

      if (isDependabotContainer) {
        // For dependabot containers, run CA certificates update as root first
        await this.execCommand(
          container,
          ['/usr/sbin/update-ca-certificates'],
          'root'
        )

        // Then run the dependabot commands as dependabot user
        const dependabotCommands = [
          'mkdir -p /home/dependabot/dependabot-updater/output',
          '$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files',
          '$DEPENDABOT_HOME/dependabot-updater/bin/run update_files'
        ]

        for (const cmd of dependabotCommands) {
          await this.execCommand(
            container,
            ['/bin/sh', '-c', cmd],
            'dependabot'
          )
        }
      } else {
        // For test containers and other containers, just wait for completion
        const outcome = await container.wait()
        if (outcome.StatusCode !== 0) {
          throw new Error(`Container exited with code ${outcome.StatusCode}`)
        }
      }

      return true
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
  }
}
