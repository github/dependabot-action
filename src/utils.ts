import stream, {Writable} from 'stream'
import {DependencyFile} from './config-types'

const AZURE_REGISTRY_RE = /^[\w-.]*\.azure-api\.net\//

const base64Decode = (str: string): string =>
  Buffer.from(str, 'base64').toString('binary')

export const base64DecodeDependencyFile = (
  file: DependencyFile
): DependencyFile => {
  const fileCopy = JSON.parse(JSON.stringify(file))
  fileCopy.content = base64Decode(fileCopy.content)
  return fileCopy
}

export const outStream = (prefix: string): Writable => {
  return new stream.Writable({
    write(chunk, _, next) {
      process.stderr.write(`${prefix} | ${chunk.toString()}`)
      next()
    }
  })
}

export const errStream = (prefix: string): Writable => {
  return new stream.Writable({
    write(chunk, _, next) {
      process.stderr.write(`${prefix} | ${chunk.toString()}`)
      next()
    }
  })
}

/**
 * Extracts the SHA from an updater image string.
 * @param updaterImage - Image string in the format "image:sha" or "registry/image:sha"
 * @returns The SHA part after the last colon, or null if no colon is found
 */
export const extractUpdaterSha = (updaterImage: string): string | null => {
  const match = updaterImage.match(/:([^:]*)$/)
  return match ? match[1] : null
}

/**
 * @param imageName - Image string including repository
 * @returns True if the given imageName is from a permissible repository
 */
export const validImageRepository = (imageName: string): boolean => {
  return (
    imageName.startsWith('ghcr.io/') ||
    imageName.startsWith('docker.pkg.github.com/') ||
    AZURE_REGISTRY_RE.test(imageName)
  )
}
