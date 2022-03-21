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
      This method fetches images using a GITHUB_TOKEN we should check two things:
      - The process has a GITHUB_TOKEN set so we don't attempt a failed call to docker
      - The image being requested is actually hosted on GitHub.

      We expose the `fetch_image` utility method to allow us to pull in arbitrary images
      without auth in unit tests.
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

    if (!process.env.GITHUB_TOKEN) {
      throw new Error('No GITHUB_TOKEN set, unable to pull images.')
    }

    const docker = new Docker()
    try {
      const image = await docker.getImage(imageName).inspect()
      if (!force) {
        core.info(`Resolved ${imageName} to existing ${image.RepoDigests}`)
        return
      } // else fallthrough to pull
    } catch (e) {
      if (!e.message.includes('no such image')) {
        throw e
      } // else fallthrough to pull
    }

    // const auth = {
    //   username: 'x',
    //   password: process.env.GITHUB_TOKEN
    // }
    await this.fetchImage(imageName, {}, docker)
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
