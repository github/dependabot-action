import {ImageService} from './image-service'
import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from './docker-tags'

export async function run(): Promise<void> {
  await ImageService.pull(UPDATER_IMAGE_NAME)
  await ImageService.pull(PROXY_IMAGE_NAME)
}

run()
