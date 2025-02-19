import * as core from '@actions/core'
import Docker from 'dockerode'
import {Readable} from 'stream'

const MAX_RETRIES = 5 // Maximum number of retries
const INITIAL_DELAY_MS = 2000 // Initial delay in milliseconds for backoff

const sleep = async (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const endOfStream = async (docker: Docker, stream: Readable): Promise<void> => {
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) =>
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
    await this.fetchImageWithRetry(imageName, auth, docker)
  },

  /* Retrieve the image using the auth details provided, if any with retry and backoff */
  async fetchImageWithRetry(
    imageName: string,
    auth = {},
    docker = new Docker()
  ): Promise<void> {
    let attempt = 0

    while (attempt < MAX_RETRIES) {
      try {
        core.info(`Pulling image ${imageName} (attempt ${attempt + 1})...`)
        const stream = await docker.pull(imageName, {authconfig: auth})
        await endOfStream(docker, new Readable().wrap(stream))
        core.info(`Pulled image ${imageName}`)
        return // Exit on success
      } catch (error) {
        attempt++

        if (
          error instanceof Error &&
          (error.message.includes('429') ||
            error.message.toLowerCase().includes('too many requests'))
        ) {
          const delay = INITIAL_DELAY_MS * Math.pow(2, attempt) // Exponential backoff
          core.warning(
            `Received Too Many Requests error. Retrying in ${delay / 1000} seconds...`
          )
          await sleep(delay)
        } else if (attempt >= MAX_RETRIES) {
          core.error(
            `Failed to pull image ${imageName} after ${MAX_RETRIES} attempts.`
          )
          throw error
        } else {
          core.warning(
            `Error pulling image ${imageName}: ${error}. Retrying...`
          )
          await sleep(INITIAL_DELAY_MS * Math.pow(2, attempt))
        }
      }
    }
  }
}
