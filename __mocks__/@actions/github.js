const fs = require('fs')

class Context {
  constructor() {
    this.payload = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : {}
    this.eventName = process.env.GITHUB_EVENT_NAME
    this.actor = process.env.GITHUB_ACTOR
  }
}

module.exports.context = new Context()
