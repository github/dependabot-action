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

/** Fetch the configured updater image, if it isn't already available. */
export const ImageService = {
  async pull(imageName: string, force = false): Promise<void> {
    /*
      This method fetches images hosts on GitHub infrastructure.

      We expose the `fetch_image` utility method to allow us to pull in arbitrary images for unit tests.
    */
    if (
      !(
        imageName.startsWith('ghcr.io/') ||
        imageName.startsWith('docker.pkg.github.com/')
      )
    ) {
      throw new Error(
        'Only images distributed via docker.pkg.github.com or ghcr.io can be fetched'
      )
    }

    const docker = new Docker()
    try {
      const image = await docker.getImage(imageName).inspect()
      if (!force) {
        core.info(`Resolved ${imageName} to existing ${image.RepoDigests}`)
        return
      } // else fallthrough to pull
    } catch (e: unknown) {
      if (e instanceof Error && !e.message.includes('no such image')) {
        throw e
      } // else fallthrough to pull
    }

    const auth = {} // Images are public so not authentication info is required
    await this.fetchImage(imageName, auth, docker)
  },

  /* Retrieve the imageName using the auth details provided, if any */
  async fetchImage(
    imageName: string,
    auth = {},
    docker = new Docker()
  ): Promise<void> {
    core.info(`Pulling image ${imageName}...`)
    const stream = await docker.pull(imageName, {authconfig: auth})
    await endOfStream(docker, stream)
    core.info(`Pulled image ${imageName}`)
  }
}
