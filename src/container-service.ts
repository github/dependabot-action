import * as core from '@actions/core'
import {Container} from 'dockerode'
import {pack} from 'tar-stream'
import {FileFetcherInput, FileUpdaterInput} from './file-types'

export const ContainerService = {
  async storeInput(
    name: string,
    path: string,
    container: Container,
    input: FileFetcherInput | FileUpdaterInput
  ): Promise<void> {
    const tar = pack()
    tar.entry({name}, JSON.stringify(input))
    tar.finalize()
    await container.putArchive(tar, {path})
  },

  async run(container: Container): Promise<void> {
    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      })
      container.modem.demuxStream(stream, process.stdout, process.stderr)

      await container.start()
      await container.wait()
    } finally {
      await container.remove()
      core.info(`Cleaned up container ${container.id}`)
    }
  }
}
