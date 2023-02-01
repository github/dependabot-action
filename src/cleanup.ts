import * as core from '@actions/core'
import Docker from 'dockerode'
import {
  updaterImages,
  PROXY_IMAGE_NAME,
  digestName,
  hasDigest,
  repositoryName
} from './docker-tags'

// This method performs housekeeping checks to remove Docker artifacts
// which were left behind by old versions of the action or any jobs
// which may have crashed before deleting their own containers or networks
//
// cutoff - a Go duration string to pass to the Docker API's 'until' argument, default '24h'
export async function run(cutoff = '24h'): Promise<void> {
  if (process.env.DEPENDABOT_DISABLE_CLEANUP === '1') {
    return
  }

  try {
    const docker = new Docker()
    const untilFilter = {until: [cutoff]}
    core.info(`Pruning networks older than ${cutoff}`)
    await docker.pruneNetworks({filters: untilFilter})
    core.info(`Pruning containers older than ${cutoff}`)
    await docker.pruneContainers({filters: untilFilter})
    for (const image of updaterImages()) {
      await cleanupOldImageVersions(docker, image)
    }
    await cleanupOldImageVersions(docker, PROXY_IMAGE_NAME)
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.error(`Error cleaning up: ${error.message}`)
    }
  }
}

export async function cleanupOldImageVersions(
  docker: Docker,
  imageName: string
): Promise<void> {
  const repo = repositoryName(imageName)
  const options = {
    filters: repo
  }

  core.info(`Cleaning up images for ${repo}`)

  docker.listImages(options, async function (err, imageInfoList) {
    if (imageInfoList && imageInfoList.length > 0) {
      for (const imageInfo of imageInfoList) {
        // The given imageName is expected to be a tag + digest, however to avoid any surprises in future
        // we fail over to check for a match on just tags as well.
        //
        // This means we won't remove any image which matches an imageName of either of these notations:
        // - dependabot/image:$TAG@sha256:$REF (current implementation)
        // - dependabot/image:v1
        //
        // Without checking imageInfo.RepoTags for a match, we would actually remove the latter even if
        // this was the active version.
        if (imageMatches(imageInfo, imageName)) {
          core.info(`Skipping current image ${imageInfo.Id}`)
          continue
        }

        core.info(`Removing image ${imageInfo.Id}`)
        try {
          await docker.getImage(imageInfo.Id).remove()
        } catch (error: unknown) {
          if (error instanceof Error) {
            core.info(`Unable to remove ${imageInfo.Id} -- ${error.message}`)
          }
        }
      }
    }
  })
}

function imageMatches(imageInfo: Docker.ImageInfo, imageName: string): boolean {
  if (hasDigest(imageName)) {
    return imageInfo.RepoDigests
      ? imageInfo.RepoDigests.includes(digestName(imageName))
      : false
  }
  return imageInfo.RepoTags ? imageInfo.RepoTags.includes(imageName) : false
}

run()
