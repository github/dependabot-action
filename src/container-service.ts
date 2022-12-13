import * as core from '@actions/core'
import {Container} from 'dockerode'
import {pack} from 'tar-stream'
import {FileFetcherInput, FileUpdaterInput, ProxyConfig} from './config-types'
import {outStream, errStream} from './utils'
import {PassThrough} from 'stream'

export class ContainerRuntimeError extends Error {}

export const ContainerService = {
  async storeInput(
    name: string,
    path: string,
    container: Container,
    input: FileFetcherInput | FileUpdaterInput | ProxyConfig
  ): Promise<void> {
    const tar = pack()
    tar.entry({name}, JSON.stringify(input))
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
    core.info('Running container...')

    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      })
      const passthrough = new PassThrough()
      stream.pipe(passthrough)
      container.modem.demuxStream(
        passthrough,
        outStream('updater'),
        errStream('updater')
      )
      const running = new Promise(resolve => {
        passthrough.on('data', (data: Buffer) => {
          if (data.toString().includes('Press enter to run the update')) {
            resolve(true)
          }
        })
      })

      await container.start()

      // wait for the container to start
      await running

      // attach as root and run update-ca-certificates
      const exec = await container.exec({
        User: 'root',
        Cmd: [
          'sh',
          '-c',
          '(echo > /etc/ca-certificates.conf) && ' +
            'rm -Rf /usr/share/ca-certificates/ && ' +
            '/usr/sbin/update-ca-certificates &&' +
            'killall -u dependabot sleep'
        ],
        AttachStdout: true,
        AttachStderr: true
      })
      const execStream = await exec.start({})
      await new Promise((resolve, reject) => {
        execStream.on('end', resolve)
        execStream.on('error', reject)
      })
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
