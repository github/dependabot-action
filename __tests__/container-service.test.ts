import Docker from 'dockerode'

import {ContainerService} from '../src/container-service'
import {ImageService} from '../src/image-service'

describe('ContainerService', () => {
  const docker = new Docker()
  let container: any

  beforeAll(async () => {
    /* We use alpine as a small, easy-to-script-for test stand-in for the updater */
    await ImageService.fetchImageWithRetry(
      'alpine',
      {},
      docker,
      undefined,
      'dependabot'
    )
  }, 30000)

  describe('when a container runs successfully', () => {
    beforeEach(async () => {
      container = await docker.createContainer({
        Image: 'alpine',
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['/bin/sh', '-c', 'echo $VAR'],
        Env: ['VAR=env-var']
      })
    })

    jest.setTimeout(5000)
    test('it returns true', async () => {
      expect(await ContainerService.run(container)).toBe(true)
    })
  })

  describe('when a container runs unsuccessfully', () => {
    beforeEach(async () => {
      container = await docker.createContainer({
        Image: 'alpine',
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['/bin/sh', '-c', 'nosuchccommand']
      })
    })

    jest.setTimeout(5000)
    test('raises an exception', async () => {
      await expect(ContainerService.run(container)).rejects.toThrow(
        /The updater encountered one or more errors/
      )
    })
  })

  describe('updaterCommands', () => {
    test('the fetch phase only runs the file fetcher', () => {
      expect(ContainerService.updaterCommands('fetch')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files'
      ])
    })

    test('the update phase only runs the file updater', () => {
      expect(ContainerService.updaterCommands('update')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run update_files'
      ])
    })

    test('the update phase honours the graph command', () => {
      expect(ContainerService.updaterCommands('update', 'graph')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run update_graph'
      ])
    })

    test('the all phase runs both halves in one container', () => {
      expect(ContainerService.updaterCommands('all')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run update_files'
      ])
    })
  })
})
