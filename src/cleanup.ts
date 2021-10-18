import * as core from '@actions/core'
import Docker from 'dockerode'

export async function run(): Promise<void> {
  try {
    const docker = new Docker()
    await docker.pruneNetworks({filters: {until: '24h'}})
    await docker.pruneContainers({filters: {until: '24h'}})
  } catch (error) {
    core.debug(`Error cleaning up: ${error.message}`)
  }
}

run()
