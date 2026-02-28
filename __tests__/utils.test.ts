import {
  base64DecodeDependencyFile,
  extractUpdaterSha,
  validImageRepository
} from '../src/utils'

describe('base64DecodeDependencyFile', () => {
  test('clones the dependency file', () => {
    const dependencyFile = {
      name: 'package.json',
      content: 'dGVzdCBzdHJpbmc=',
      directory: '/',
      type: 'file',
      support_file: false,
      content_encoding: 'utf-8',
      deleted: false,
      operation: 'add'
    }

    const decoded = base64DecodeDependencyFile(dependencyFile)
    expect(decoded.content).toEqual('test string')
    expect(dependencyFile.content).toEqual('dGVzdCBzdHJpbmc=')
  })
})

describe('extractUpdaterSha', () => {
  test('extracts SHA from full image string with registry', () => {
    const image =
      'ghcr.io/dependabot/dependabot-updater-gomod:04aab0a156d33033b6082c7deb5feb6a212e4174'
    const sha = extractUpdaterSha(image)
    expect(sha).toEqual('04aab0a156d33033b6082c7deb5feb6a212e4174')
  })

  test('extracts SHA from simple image string', () => {
    const image = 'dependabot-updater:abc123'
    const sha = extractUpdaterSha(image)
    expect(sha).toEqual('abc123')
  })

  test('handles image string with multiple colons by using the last one', () => {
    const image = 'localhost:5000/dependabot/updater:sha256'
    const sha = extractUpdaterSha(image)
    expect(sha).toEqual('sha256')
  })

  test('returns null for image string without colon', () => {
    const image = 'dependabot-updater'
    const sha = extractUpdaterSha(image)
    expect(sha).toBeNull()
  })

  test('returns empty string for image string ending with colon', () => {
    const image = 'dependabot-updater:'
    const sha = extractUpdaterSha(image)
    expect(sha).toEqual('')
  })
})

describe('validImageRepository', () => {
  test('image from ghcr.io', () => {
    const image = 'ghcr.io/dependabot/dependabot-updater-npm'
    const result = validImageRepository(image)
    expect(result).toBeTruthy()
  })

  test('image from docker.pkg.github.com', () => {
    const image = 'docker.pkg.github.com/dependabot/dependabot-updater-npm'
    const result = validImageRepository(image)
    expect(result).toBeTruthy()
  })

  test('image from azure-api.net', () => {
    const image =
      'my-api.azure-api.net/ghcr.io/dependabot/dependabot-updater-npm'
    const result = validImageRepository(image)
    expect(result).toBeTruthy()
  })

  test('image name blank', () => {
    const image = ''
    const result = validImageRepository(image)
    expect(result).toBeFalsy()
  })

  test('image name from outside source', () => {
    const image = 'docker.com/dependabot/dependabot-updater-npm'
    const result = validImageRepository(image)
    expect(result).toBeFalsy()
  })
})
