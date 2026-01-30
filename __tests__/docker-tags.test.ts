import {
  updaterImages,
  PROXY_IMAGE_NAME,
  digestName,
  hasDigest,
  repositoryName
} from '../src/docker-tags'
import {getImageName} from '../src/update-containers'

describe('Docker tags', () => {
  test('updater images use a pinned version and matches the config Dockerfile', () => {
    for (const image of updaterImages()) {
      expect(image).toMatch(
        /^ghcr\.io\/dependabot\/dependabot-updater-[-\w]+:v\d.\d.\d{14}@sha256:[a-zA-Z0-9]{64}$/
      )

      expect(image).toEqual(
        getImageName(
          `Dockerfile.${image.match(/dependabot-updater-([-\w]+)/)?.[1]}`
        )
      )
    }
  })

  test('PROXY_IMAGE_NAME uses a pinned version and matches the config Dockerfile', () => {
    expect(PROXY_IMAGE_NAME).toMatch(
      /^ghcr\.io\/dependabot\/proxy:v\d.\d.\d{14}@sha256:[a-zA-Z0-9]{64}$/
    )

    expect(PROXY_IMAGE_NAME).toEqual(getImageName('Dockerfile.proxy'))
  })

  test('repositoryName returns the image name minus the tagged version and reference for our real values', () => {
    for (const image of updaterImages()) {
      expect(repositoryName(image)).toMatch(
        /^ghcr.io\/dependabot\/dependabot-updater-[-\w]+$/
      )
    }

    expect(repositoryName(PROXY_IMAGE_NAME)).toMatch('ghcr.io/dependabot/proxy')
  })

  test('repositoryName handles named tags', () => {
    // We currently use pinned SHA references in addition to tags, but we should account for both notations
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

  test('digestName returns the image name and digest minus the tagged version or reference', () => {
    expect(
      digestName(
        'ghcr.io/dependabot/proxy:v2.0.20260129233510@sha256:aee1af4a514c0c5e573f3b33a51f9f2b9c58234cb011ea4d44b9e05aec92436c'
      )
    ).toMatch(
      'ghcr.io/dependabot/proxy@sha256:aee1af4a514c0c5e573f3b33a51f9f2b9c58234cb011ea4d44b9e05aec92436c'
    )

    expect(
      digestName(
        'ghcr.io/dependabot/proxy@sha256:aee1af4a514c0c5e573f3b33a51f9f2b9c58234cb011ea4d44b9e05aec92436c'
      )
    ).toMatch(
      'ghcr.io/dependabot/proxy@sha256:aee1af4a514c0c5e573f3b33a51f9f2b9c58234cb011ea4d44b9e05aec92436c'
    )
  })

  test('hasDigest identifies when a digest is present', () => {
    expect(
      hasDigest(
        'ghcr.io/dependabot/proxy:v2.0.20260129233510@sha256:aee1af4a514c0c5e573f3b33a51f9f2b9c58234cb011ea4d44b9e05aec92436c'
      )
    ).toEqual(true)

    expect(hasDigest('ghcr.io/dependabot/proxy:v1')).toEqual(false)
  })
})
