import * as Docker from 'dockerode'

export async function pullImage(docker: Docker, image: string): Promise<void> {
  const stream = await docker.pull(image)
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error) =>
      err ? reject(err) : resolve(null)
    )
  })
}
