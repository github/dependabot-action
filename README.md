## Setup

### Prerequisites

**Node Version Manager**: e.g. `brew install nvm` on Mac

**Docker**: e.g. `brew install docker` on Mac

### Project dependencies

```bash
$ nvm use
$ npm install
```

## Tests

Run the tests (excluding integration tests) :heavy_check_mark:

```bash
$ npm test

 PASS  ./index.test.js
  ✓ throws invalid number (3ms)
  ✓ wait 500 ms (504ms)
  ✓ test runs (95ms)

...
```

### Running integration tests

```bash
$ npm run test-integration
```

The integration test will time out if you don't already have the docker image on
your local machine.

You'll need to create a [GitHub PAT](https://github.com/settings/tokens/new)
(Personal Access Token) to access the updater image hosted on [dependabot/dependabot-updater](https://github.com/dependabot/dependabot-updater/pkgs/container/dependabot-updater%2Fdependabot-updater).

Create the PAT with `read:packages` permissions checked and export it:

```bash
export GPR_TOKEN=_pat_with_read_packages_
```

Pull the updater image:

```bash
docker login docker.pkg.github.com -u x -p $GPR_TOKEN
docker pull docker.pkg.github.com/dependabot/dependabot-updater:latest
```

#### Debugging the fake dependabot-api json-server

Integration tests run against a fake dependabot-api server using
[json-server](https://github.com/typicode/json-server).

Initial responses are defined in `__tess__/server/db.json` and the server itself
configured in `__tests__server/server.js`.

Run the api server outside of tests:

```bash
node __tests__/server/server.js
```

Inspect resources:

```bash
curl http://localhost:9000/update_jobs/1/details
```

### Running against a local dependabot-api instance

TBD

## Releasing a new version of the action

Actions executes the `dist/index.js` file when run, defined in `action.yml`. This is packaged using [ncc](https://github.com/zeit/ncc).

To update the `dist/index.js` run:

```bash
$ npm run package
```

### Tagging releases

When tagging a release, use semver e.g. `v1.0.0`.

Also update the major version tag to point to the latest major release, e.g. `git tag v1`.

### Major versions

Create a new `releases/v1` branch before merging a `v2` branch to main to allow releasing patch releases of previous major versions.

![versioning](https://github.com/actions/toolkit/blob/master/docs/assets/action-releases.png)
