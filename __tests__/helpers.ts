import Docker from 'dockerode'
import {UPDATER_IMAGE_NAME} from '../src/main'

export const removeDanglingUpdaterContainers = async (): Promise<void> => {
  const docker = new Docker()
  const containers = (await docker.listContainers()) || []

  for (const container of containers) {
    if (container.Image.includes(UPDATER_IMAGE_NAME)) {
      try {
        await docker.getContainer(container.Id).remove({v: true, force: true})
      } catch (e) {
        // ignore
      }
    }
  }
}
