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
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      })
      container.modem.demuxStream(
        stream,
        outStream('updater'),
        errStream('updater')
      )

      await container.start()
      const outcome = await container.wait()

      if (outcome.StatusCode === 0) {
        return true
      } else {
        core.info(`Failure running container ${container.id}`)
        throw new ContainerRuntimeError(
          'The updater encountered one or more errors.'
        )
      }
    } finally {
      await container.remove({v: true})
      core.info(`Cleaned up container ${container.id}`)
    }
  }
}
