import {ImageService} from './image-service'
import {updaterImageName, PROXY_IMAGE_NAME} from './docker-tags'

export async function run(packageManager: string): Promise<void> {
  await ImageService.pull(updaterImageName(packageManager))
  await ImageService.pull(PROXY_IMAGE_NAME)
}

if (process.argv.length < 2) {
  // eslint-disable-next-line no-console
  console.error('Usage: npm run fetch-images <package-manager>')
  process.exit(1)
}

run(process.argv[2])
