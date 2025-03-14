import fs from 'fs'

export function getImageName(dockerfileName: string): string {
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
  bundler: getImageName('Dockerfile.bundler'),
  cargo: getImageName('Dockerfile.cargo'),
  composer: getImageName('Dockerfile.composer'),
  pub: getImageName('Dockerfile.pub'),
  docker: getImageName('Dockerfile.docker'),
  elm: getImageName('Dockerfile.elm'),
  github_actions: getImageName('Dockerfile.github-actions'),
  submodules: getImageName('Dockerfile.gitsubmodule'),
  go_modules: getImageName('Dockerfile.gomod'),
  gradle: getImageName('Dockerfile.gradle'),
  maven: getImageName('Dockerfile.maven'),
  hex: getImageName('Dockerfile.mix'),
  nuget: getImageName('Dockerfile.nuget'),
  npm_and_yarn: getImageName('Dockerfile.npm'),
  pip: getImageName('Dockerfile.pip'),
  swift: getImageName('Dockerfile.swift'),
  terraform: getImageName('Dockerfile.terraform'),
  devcontainers: getImageName('Dockerfile.devcontainers'),
  dotnet_sdk: getImageName('Dockerfile.dotnet-sdk'),
  bun: getImageName('Dockerfile.bun'),
  docker_compose: getImageName('Dockerfile.docker-compose'),
  uv: getImageName('Dockerfile.uv'),
  helm: getImageName('Dockerfile.helm')
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
