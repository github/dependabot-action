import fs from 'fs'

const dockerfile = fs.readFileSync(require.resolve('../Dockerfile'), 'utf8')

const imageNames = dockerfile
  .split(/\n/)
  .filter(a => a.startsWith('FROM'))
  .map(a => a.replace('FROM', '').trim())

const updaterImageName = imageNames.find(a =>
  a.includes('dependabot/dependabot-updater')
)
const proxyImageName = imageNames.find(a =>
  a.includes('github/dependabot-update-job-proxy')
)

if (!updaterImageName) {
  throw new Error('Could not find dependabot-updater image name')
}

if (!proxyImageName) {
  throw new Error('Could not find dependabot-update-job-proxy image name')
}

export const UPDATER_IMAGE_NAME = updaterImageName
export const PROXY_IMAGE_NAME = proxyImageName
