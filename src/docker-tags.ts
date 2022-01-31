import * as fs from 'fs'
import * as path from 'path'

const dockerfile = fs.readFileSync(
  path.join(__dirname, '..', 'Dockerfile'),
  'utf8'
)

const imageNames = dockerfile
  .split(/\n/)
  .filter(a => a.startsWith('FROM'))
  .map(a => a.replace('FROM', '').trim())

export const UPDATER_IMAGE_NAME =
  imageNames.find(a => a.includes('dependabot/dependabot-updater')) ||
  '!! not-found'
export const PROXY_IMAGE_NAME =
  imageNames.find(a => a.includes('github/dependabot-update-job-proxy')) ||
  '!! not-found'
