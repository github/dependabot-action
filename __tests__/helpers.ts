import Docker from 'dockerode'
import {updaterImages, PROXY_IMAGE_NAME} from '../src/docker-tags'
import waitPort from 'wait-port'
import path from 'path'
import {spawn} from 'child_process'

export const removeDanglingUpdaterContainers = async (): Promise<void> => {
  const docker = new Docker()
  const containers = (await docker.listContainers()) || []

  for (const container of containers) {
    if (
      updaterImages().includes(container.Image) ||
      container.Image.includes(PROXY_IMAGE_NAME)
    ) {
      try {
        await docker.getContainer(container.Id).remove({v: true, force: true})
      } catch (e) {
        console.log(e) // eslint-disable-line no-console
      }
    }
  }

  // Wait a bit for network endpoints to be properly disconnected
  await new Promise(resolve => setTimeout(resolve, 1000))

  await docker.pruneNetworks()
  await docker.pruneContainers()
}

export const runFakeDependabotApi = async (
  port = 9000,
  testRetry = false
): Promise<() => void> => {
  const server = spawn(
    'node',
    [`${path.join(__dirname, 'server/server.js')}`, `${port}`],
    {env: {...process.env, TEST_RETRY: `${testRetry}`}}
  )

  server.stdout.on('data', (data: any) => {
    console.log(`json-server log: ${data}`) // eslint-disable-line no-console
  })
  server.stderr.on('data', (data: any) => {
    console.error(`json-server error: ${data}`) // eslint-disable-line no-console
  })

  await waitPort({port})

  return (): void => {
    server.kill()
  }
}

export const eventFixturePath = (fixtureName: string): string => {
  return path.join(
    __dirname,
    '..',
    '__fixtures__',
    'events',
    `${fixtureName}.json`
  )
}

export const integration = process.env.SKIP_INTEGRATION_TESTS
  ? describe.skip
  : describe

export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
