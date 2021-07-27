#!/usr/bin/env node

const jsonServer = require('json-server')
const path = require('path')
const fs = require('fs')
const server = jsonServer.create()
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json')))
const router = jsonServer.router(db)
const middlewares = jsonServer.defaults()

const SERVER_PORT = process.argv.slice(2)[0] || 9000

// NOTE: Serialise the response like dependabot-api
router.render = (_, res) => {
  const id = res.locals.data.id
  const data = {
    attributes: res.locals.data
  }
  if (id) {
    data.id = id
  }
  res.jsonp({
    data
  })
}

server.use(middlewares)

// Inject a legit GITHUB_TOKEN to increase rate limits fetching manifests from github
server.get('/update_jobs/:id/credentials', (_, res) => {
  res.jsonp({
    data: {
      attributes: {
        credentials: {
          type: 'git_source',
          host: 'github.com',
          username: 'x-access-token',
          password: process.env.GITHUB_TOKEN
        }
      }
    }
  })
})

server.post(
  '/update_jobs/:id/create_pull_request',
  jsonServer.bodyParser,
  (req, res) => {
    const data = {...req.body.data, id: req.params.id}
    db.pull_requests.push(data)
    router.db.write()

    res.jsonp({})
  }
)

// TEMP HACK: Always return 204 on post so the updater doesn't buil out
server.use(jsonServer.bodyParser, (req, res, next) => {
  if (req.method === 'POST' && req.body.data) {
    req.body = req.body.data
    res.sendStatus(204)
    return
  }
  next()
})

// NOTE: These map to resources in db.json
server.use(
  jsonServer.rewriter({
    '/update_jobs/:id/details': '/update_jobs/:id',
    '/update_jobs/:id/credentials': '/credentials/:id',
    '/update_jobs/:id/record_update_job_error': '/update_job_errors/:id',
    '/update_jobs/:id/mark_as_processed': '/update_jobs/:id',
    '/update_jobs/:id/update_dependency_list': '/dependencies/:id',
    '/update_jobs/:id/record_package_manager_version': '/update_jobs/:id'
  })
)

server.use(router)
server.listen(SERVER_PORT, () => {
  console.log(`json-server is running on http://localhost:${SERVER_PORT}`)
})
