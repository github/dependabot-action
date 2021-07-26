import {ImageService} from '../src/image-service'

describe('ImageService', () => {
  test('pulls the image from docker hub', async () => {
    await ImageService.pull('hello-world')
  })
})
