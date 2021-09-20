import Docker from 'dockerode'

import {ContainerService} from '../src/container-service'
import {ImageService} from '../src/image-service'

describe('ContainerService', () => {
  const docker = new Docker()
  let container: any

  describe('when a container runs successfully', () => {
    beforeEach(async () => {
      await ImageService.pull('alpine')
      container = await docker.createContainer({
        Image: 'alpine',
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['/bin/sh', '-c', 'echo $VAR'],
        Env: ['VAR=env-var']
      })
    })

    test('it returns true', async () => {
      expect(await ContainerService.run(container)).toBe(true)
    })
  })

  describe('when a container runs unsuccessfully', () => {
    beforeEach(async () => {
      await ImageService.pull('alpine')
      container = await docker.createContainer({
        Image: 'alpine',
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['/bin/sh', '-c']
      })
    })

    test('raises an exception', async () => {
      await expect(ContainerService.run(container)).rejects.toThrow()
    })
  })
})
