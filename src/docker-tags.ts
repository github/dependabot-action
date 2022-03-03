import dockerContainerConfig from '../docker/containers.json'

export const UPDATER_IMAGE_NAME = dockerContainerConfig.updater
export const PROXY_IMAGE_NAME = dockerContainerConfig.proxy

const imageNamePattern =
  '^(?<repository>(([a-zA-Z0-9._-]+([:[0-9]+[^/]))?([a-zA-Z0-9._/-]+)?))((:[a-zA-Z0-9._/-]+)|(@sha256:[a-zA-Z0-9]{64}))?$'

export function repositoryName(imageName: string): string {
  const match = imageName.match(imageNamePattern)

  if (match?.groups) {
    return match.groups['repository']
  } else {
    throw Error('invalid image name')
  }
}
