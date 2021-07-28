import Docker from 'dockerode'

import {ContainerService} from '../src/container-service'
import {ImageService} from '../src/image-service'

describe('ContainerService', () => {
  const docker = new Docker()
  let container: any

  beforeAll(async () => {
    await ImageService.pull('alpine')
    container = await docker.createContainer({
      Image: 'alpine',
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['/bin/sh', '-c', 'echo $VAR'],
      Env: ['VAR=env-var']
    })
  })

  test('runs containers', async () => {
    await ContainerService.run(container)
  })
})
