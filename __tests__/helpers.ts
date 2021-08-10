import Docker from 'dockerode'
import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from '../src/main'
import waitPort from 'wait-port'
import path from 'path'
import {spawn} from 'child_process'

export const removeDanglingUpdaterContainers = async (): Promise<void> => {
  const docker = new Docker()
  const containers = (await docker.listContainers()) || []

  for (const container of containers) {
    if (
      container.Image.includes(UPDATER_IMAGE_NAME) ||
      container.Image.includes(PROXY_IMAGE_NAME)
    ) {
      try {
        await docker.getContainer(container.Id).remove({v: true, force: true})
      } catch (e) {
        // ignore
      }
    }
  }
}

export const runFakeDependabotApi = async (port: number): Promise<Function> => {
  const server = spawn('node', [
    `${path.join(__dirname, 'server/server.js')}`,
    `${port}`
  ])

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
