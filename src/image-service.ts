import * as core from '@actions/core'
import Docker from 'dockerode'
import {Readable} from 'stream'

const endOfStream = async (docker: Docker, stream: Readable): Promise<void> => {
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error) =>
      err ? reject(err) : resolve(undefined)
    )
  })
}

export const ImageService = {
  /** Fetch the configured updater image, if it isn't already available. */
  async pull(imageName: string, force = false): Promise<void> {
    const docker = new Docker()
    try {
      const image = await docker.getImage(imageName).inspect()
      if (!force) {
        core.info(`Resolved ${imageName} to existing ${image.Id}`)
        return
      } // else fallthrough to pull
    } catch (e) {
      if (!e.message.includes('no such image')) {
        throw e
      } // else fallthrough to pull
    }

    core.info(`Pulling image ${imageName}...`)
    const auth = {
      username: 'x',
      password: process.env.GITHUB_TOKEN
    }
    const stream = await docker.pull(imageName, {authconfig: auth})
    await endOfStream(docker, stream)
    core.info(`Pulled image ${imageName}`)
  }
}
