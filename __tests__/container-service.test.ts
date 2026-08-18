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
    test('the fetch phase clones and copies the checkout to the handoff volume', () => {
      expect(ContainerService.updaterCommands('fetch')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files',
        'cp -a /home/dependabot/dependabot-updater/repo/. /home/dependabot/dependabot-updater/repo-handoff/'
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

    test('the all phase lets update_files fetch in-process', () => {
      expect(ContainerService.updaterCommands('all')).toEqual([
        'mkdir -p /home/dependabot/dependabot-updater/output',
        '$DEPENDABOT_HOME/dependabot-updater/bin/run update_files'
      ])
    })
  })

  describe('the fetch phase', () => {
    test('prepares the repository volume for the dependabot user', async () => {
      const dependabotContainer: any = {
        id: 'fetch-container',
        start: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockResolvedValue({
          Config: {Env: ['DEPENDABOT_JOB_ID=1']}
        }),
        remove: jest.fn().mockResolvedValue(undefined)
      }
      const execCommand = jest
        .spyOn(ContainerService, 'execCommand')
        .mockResolvedValue(undefined)

      await ContainerService.runFileFetcher(dependabotContainer)

      expect(execCommand.mock.calls).toEqual([
        [dependabotContainer, ['/usr/sbin/update-ca-certificates'], 'root'],
        [
          dependabotContainer,
          [
            'chown',
            'dependabot',
            '/home/dependabot/dependabot-updater/repo',
            '/home/dependabot/dependabot-updater/repo-handoff'
          ],
          'root'
        ],
        [
          dependabotContainer,
          [
            '/bin/sh',
            '-c',
            'mkdir -p /home/dependabot/dependabot-updater/output'
          ],
          'dependabot'
        ],
        [
          dependabotContainer,
          [
            '/bin/sh',
            '-c',
            '$DEPENDABOT_HOME/dependabot-updater/bin/run fetch_files'
          ],
          'dependabot'
        ],
        [
          dependabotContainer,
          [
            '/bin/sh',
            '-c',
            'cp -a /home/dependabot/dependabot-updater/repo/. /home/dependabot/dependabot-updater/repo-handoff/'
          ],
          'dependabot'
        ]
      ])
    })
  })
})
