import * as core from '@actions/core'
import Docker = require('dockerode') // eslint-disable-line @typescript-eslint/no-require-imports

export async function run(): Promise<void> {
  try {
    const docker = new Docker()
    const untilFilter = JSON.stringify({until: '24h'})
    await docker.pruneNetworks({filters: untilFilter})
    await docker.pruneContainers({filters: untilFilter})
  } catch (error) {
    core.debug(`Error cleaning up: ${error.message}`)
  }
}

run()
