import {UPDATER_IMAGE_NAME, PROXY_IMAGE_NAME} from '../src/docker-tags'

describe('Docker tags', () => {
  test('UPDATER_IMAGE_NAME', () => {
    expect(UPDATER_IMAGE_NAME).toMatch(
      /^docker\.pkg\.github\.com\/dependabot\/dependabot-updater@sha256:[a-zA-Z0-9]{64}$/
    )
  })

  test('PROXY_IMAGE_NAME', () => {
    expect(PROXY_IMAGE_NAME).toMatch(
      /^docker\.pkg\.github\.com\/github\/dependabot-update-job-proxy@sha256:[a-zA-Z0-9]{64}$/
    )
  })
})
