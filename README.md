## Setup

### Prerequisites

**node**: v14 LTS and up
**docker**: current release

### Project dependencies

```bash
$ npm install
```

## Tests

Run the tests :heavy_check_mark:

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
(Personal Access Token) to access the updater image hosted on [GitHub
Packages](https://github.com/dependabot/dependabot-updater/pkgs/container/dependabot-updater%2Fdependabot-updater).

Create the PAT with `read:packages` permissions checked and export it:

```bash
export GPR_TOKEN=_pat_with_read_packages_
```

Pull the updater image:

```bash
docker login docker.pkg.github.com -u x -p $GPR_TOKEN
docker pull docker.pkg.github.com/dependabot/dependabot-updater:latest
```

## Releasing a new version of the action

Actions are run from GitHub repos so we will checkin the packed dist folder.

Then run [ncc](https://github.com/zeit/ncc) and push the results:

```bash
$ npm run package
$ git add dist
$ git commit -a -m "prod dependencies"
$ git push origin releases/v1
```

Your action is now published! :rocket:

See the [versioning documentation](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

After testing you can [create a v1 tag](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md) to reference the stable and latest V1 action

## Change action.yml

The action.yml contains defines the inputs and output for your action.

Update the action.yml with your name, description, inputs and outputs for your action.

See the [documentation](https://help.github.com/en/articles/metadata-syntax-for-github-actions)
