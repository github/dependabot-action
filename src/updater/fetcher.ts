import * as core from '@actions/core'
import * as Docker from 'dockerode'

export async function runFileFetcher(
  docker: Docker,
  image: string
): Promise<void> {
  const container = await docker.createContainer({
    Image: image,
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ['/bin/bash', '-c', 'for i in `seq 3`; do echo .; sleep 1; done']
  })
  core.info(`Created container ${container.id}`)

  try {
    await container.start()
    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    })
    container.modem.demuxStream(stream, process.stdout, process.stderr)

    await container.wait()
  } finally {
    await container.remove()
    core.info(`Cleaned up container ${container.id}`)
  }
}
