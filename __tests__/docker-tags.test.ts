import {
  UPDATER_IMAGE_NAME,
  PROXY_IMAGE_NAME,
  repositoryName
} from '../src/docker-tags'
import {getImageName} from '../src/update-containers'

describe('Docker tags', () => {
  test('UPDATER_IMAGE_NAME uses a pinned version and matches the config Dockerfile', () => {
    expect(UPDATER_IMAGE_NAME).toMatch(
      /^docker\.pkg\.github\.com\/dependabot\/dependabot-updater@sha256:[a-zA-Z0-9]{64}$/
    )

    expect(UPDATER_IMAGE_NAME).toEqual(getImageName('Dockerfile.updater'))
  })

  test('PROXY_IMAGE_NAME uses a pinned version and matches the config Dockerfile', () => {
    expect(PROXY_IMAGE_NAME).toMatch(
      /^docker\.pkg\.github\.com\/github\/dependabot-update-job-proxy@sha256:[a-zA-Z0-9]{64}$/
    )

    expect(PROXY_IMAGE_NAME).toEqual(getImageName('Dockerfile.proxy'))
  })

  test('repositoryName returns the image name minus the tagged version or reference for our real values', () => {
    expect(repositoryName(UPDATER_IMAGE_NAME)).toMatch(
      'docker.pkg.github.com/dependabot/dependabot-updater'
    )

    expect(repositoryName(PROXY_IMAGE_NAME)).toMatch(
      'docker.pkg.github.com/github/dependabot-update-job-proxy'
    )
  })

  test('repositoryName handles named tags', () => {
    // We currently use pinned SHA references instead of tags, but we should account for both notations
    // to avoid any surprises
    expect(
      repositoryName('docker.pkg.github.com/dependabot/dependabot-updater:v1')
    ).toMatch('docker.pkg.github.com/dependabot/dependabot-updater')

    expect(
      repositoryName('docker.pkg.github.com/dependabot/dependabot-updater:v1')
    ).toMatch('docker.pkg.github.com/dependabot/dependabot-updater')
  })

  test('repositoryName handles ghcr.io images', () => {
    expect(
      repositoryName('ghcr.io/dependabot/dependabot-core:0.175.0')
    ).toMatch('ghcr.io/dependabot/dependabot-core')
  })

  test('repositoryName handles other images', () => {
    // A GitHub-hosted image isn't an implicit requirement of the function
    expect(repositoryName('hello_world:latest')).toMatch('hello_world')

    expect(repositoryName('127.0.0.1:443/hello_world')).toMatch(
      '127.0.0.1:443/hello_world'
    )

    expect(repositoryName('127.0.0.1:443/hello_world:443')).toMatch(
      '127.0.0.1:443/hello_world'
    )

    expect(
      repositoryName(
        '127.0.0.1:443/hello_world@sha256:3d6c07043f4f2baf32047634a00a6581cf1124f12a30dcc859ab128f24333a3a'
      )
    ).toMatch('127.0.0.1:443/hello_world')
  })

  test('repositoryName handles garbage inputs', () => {
    expect(() => {
      repositoryName('this is just some random nonsense')
    }).toThrow('invalid image name')

    expect(() => {
      repositoryName('this-is-just-some-random-nonsense-with-an-@-in-it')
    }).toThrow('invalid image name')

    expect(() => {
      repositoryName('this-is-just-some-random-nonsense-with-an-@sha256-in-it')
    }).toThrow('invalid image name')
  })

  test('repositoryName handles garbage inputs that look like tags', () => {
    expect(
      repositoryName('this-is-just-some-random-nonsense-but-looks-like-a-tag')
    ).toMatch('this-is-just-some-random-nonsense-but-looks-like-a-tag')

    expect(
      repositoryName('this-is-just-some-random-nonsense-with-a:in-it')
    ).toMatch('this-is-just-some-random-nonsense-with-a')
  })
})
