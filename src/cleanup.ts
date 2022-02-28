import * as core from '@actions/core'
import Docker from 'dockerode'

// This method performs housekeeping checks to remove Docker artifacts
// which were left behind by old versions of the action or any jobs
// which may have crashed before deleting their own containers or networks
//
// cutoff - a Go duration string to pass to the Docker API's 'until' argument, default '24h'
export async function run(cutoff = '24h'): Promise<void> {
  try {
    const docker = new Docker()
    const untilFilter = JSON.stringify({until: cutoff})
    core.info(`Pruning networks older than ${cutoff}`)
    await docker.pruneNetworks({filters: untilFilter})
    core.info(`Pruning containers older than ${cutoff}`)
    await docker.pruneContainers({filters: untilFilter})
  } catch (error) {
    core.error(`Error cleaning up: ${error.message}`)
  }
}

run()
