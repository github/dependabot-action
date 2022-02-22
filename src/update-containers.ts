import fs from 'fs'

function getImageName(dockerfileName: string): String {
  const dockerfile = fs.readFileSync(
    require.resolve(`../docker/${dockerfileName}`),
    'utf8'
  )

  const imageName = dockerfile
    .split(/\n/)
    .find(a => a.startsWith('FROM'))
    ?.replace('FROM', '')
    .trim()

  if (!imageName) {
    throw new Error(`Could not find an image name in ${dockerfile}`)
  }

  return imageName
}

const manifest = {
  proxy: getImageName('Dockerfile.proxy'),
  updater: getImageName('Dockerfile.updater')
}

fs.writeFile(
  require.resolve(`../docker/containers.json`),
  JSON.stringify(manifest, null, 2),
  function (err) {
    if (err) {
      // eslint-disable-next-line no-console
      console.log(err)
    }
  }
)
