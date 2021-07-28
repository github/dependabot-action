const jsonServer = require('json-server')
const path = require('path')
const fs = require('fs')
const server = jsonServer.create()
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json')))
const router = jsonServer.router(db)
const middlewares = jsonServer.defaults()
const SERVER_PORT = process.argv.slice(2)[0] || 9000

// Sets up a fake dependabot-api using json-server
//
// Test it locally by running this script directly:
//
// $ node __tests__/server/server.js Running on http://localhost:9000
//
// Verify it works: curl http://localhost:9000/update_jobs/1/details
//
// The 'id' attribute is significant for json-server and maps requests tp the
// 'id' key in the db.json for the resource, for example:
//
// - GET /update_jobs/1/details and GET /update_jobs/1 return hard-coded update
//   job in db.json
// - GET /update_jobs/2 would 404
// - POST /update_jobs {data: {...attrs}} would persist a new update job with id
//   2

server.use(middlewares)

server.get('/update_jobs/:id/details', (req, res) => {
  const id = req.params.id
  const updateJob = db.update_jobs.find(job => `${job.id}` === id)
  if (!updateJob) {
    return res.status(404).end()
  }

  res.jsonp({
    data: {
      attributes: updateJob
    }
  })
})

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

    res.status(204).send()
  }
)

server.post('/update_jobs/:id/record_update_job_error', (_, res) => {
  res.status(204).send()
})

server.patch('/update_jobs/:id/mark_as_processed', (_, res) => {
  res.status(204).send()
})

server.post('/update_jobs/:id/update_dependency_list', (_, res) => {
  res.status(204).send()
})

server.post('/update_jobs/:id/record_package_manager_version', (_, res) => {
  res.status(204).send()
})

server.use(router)

server.listen(SERVER_PORT, () => {
  console.log(`json-server is running on http://localhost:${SERVER_PORT}`)
})
