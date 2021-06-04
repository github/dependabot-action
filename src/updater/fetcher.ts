import * as core from '@actions/core'
import * as Docker from 'dockerode'

export async function runFileFetcher(docker: Docker): Promise<void> {
  // hello docker
  const containers = await docker.listContainers()
  for (const container of containers) {
    core.info(`Container ${container.Id} - ${container.Names}`)
  }
}
