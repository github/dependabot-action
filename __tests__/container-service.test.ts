import Docker from 'dockerode'

import {ContainerService} from '../src/container-service'
import {ImageService} from '../src/image-service'

describe('ContainerService', () => {
  const docker = new Docker()
  let container: any

  beforeAll(async () => {
    /* We use alpine as a small, easy-to-script-for test stand-in for the updater */
    await ImageService.fetchImageWithRetry('alpine')
  })

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
})
