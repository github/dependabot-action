#!/usr/bin/env node

const jsonServer = require('json-server')
const path = require('path')
const fs = require('fs')
const server = jsonServer.create()
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json')))
const router = jsonServer.router(db)
const middlewares = jsonServer.defaults()

const SERVER_PORT = 9000

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

server.use(
  jsonServer.rewriter({
    '/update_jobs/:id/details': '/update_jobs/:id',
    '/update_jobs/:id/credentials': '/credentials/:id',
    '/update_jobs/:id/create_pull_request': '/pull_requests',
    '/update_jobs/:id/update_pull_request': '/pull_requests',
    '/update_jobs/:id/close_pull_request': '/pull_requests',
    '/update_jobs/:id/record_update_job_error': '/update_job_errors/:id',
    '/update_jobs/:id/mark_as_processed': '/update_jobs/:id',
    '/update_jobs/:id/update_dependency_list': '/dependencies/:id',
    '/update_jobs/:id/record_package_manager_version': '/update_jobs/:id'
  })
)

server.use(jsonServer.bodyParser)
// TEMP HACK: Always return 204 on post so the updater doesn't buil out
server.use((req, res, next) => {
  if (req.method === 'POST' && req.body.data) {
    req.body = req.body.data
    res.sendStatus(204)
  }
  next()
})

server.use(middlewares)
server.use(router)
server.listen(SERVER_PORT, () => {
  console.log(`JSON Server is running on http://localhost:${SERVER_PORT}`)
})
