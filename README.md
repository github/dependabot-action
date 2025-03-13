<p align="center">
  <img src="https://user-images.githubusercontent.com/7659/174594540-5e29e523-396a-465b-9a6e-6cab5b15a568.svg#gh-light-mode-only" alt="Dependabot" width="336">
  <img src="https://user-images.githubusercontent.com/7659/174594559-0b3ddaa7-e75b-4f10-9dee-b51431a9fd4c.svg#gh-dark-mode-only" alt="Dependabot" width="336">
</p>

# Updater Action

**Name:** `github/dependabot-action`

Runs Dependabot workloads via GitHub Actions.

## Usage Instructions

This action is used by the Dependabot [version][docs-version-updates] and [security][docs-security-updates] features in GitHub.com. It does not support being used in workflow files directly.

## Manually upgrading `dependabot-action` on GitHub Enterprise Server (GHES)

To manually upgrade `dependabot-action` on your [GitHub Enterprise Server (GHES)](https://github.com/enterprise), follow [these instructions](https://docs.github.com/en/enterprise-server/admin/managing-github-actions-for-your-enterprise/managing-access-to-actions-from-githubcom/manually-syncing-actions-from-githubcom).
**Warning:** The current release of `dependabot-action` only guarantees backwards compatibility with the [currently supported GHES versions](https://docs.github.com/en/enterprise-server/admin/all-releases). Once a GHES version is deprecated, future versions of `dependabot-action` may introduce incompatible changes.

##  Steps to Update Your PR and Deploy Changes
1. Make changes to the PR
2. Run the following command in your terminal on the same branch used to create the PR whenever you make changes to the PR
```bash
npm run lint-check
npm run format-check -- --write
npm run test
```

```
nvm install;nvm use;npm clean-install;npm ci;npm run package
```
Note: If you do not execute the above step ☝️ and commit the code then CI will fail with the below error:
```bash
Run script/check-diff
Detected uncommitted changes after build:
diff --git a/dist/main/index.js b/dist/main/index.js
index c09ccea..8f50b37 1006[4](https://github.com/github/dependabot-action/actions/runs/7720200685/job/21044694134?pr=1156#step:7:5)4
Binary files a/dist/main/index.js and b/dist/main/index.js differ
diff --git a/dist/main/index.js.map b/dist/main/index.js.map
index cc44481..e[5](https://github.com/github/dependabot-action/actions/runs/7720200685/job/21044694134?pr=1156#step:7:6)0840f 100[6](https://github.com/github/dependabot-action/actions/runs/7720200685/job/21044694134?pr=1156#step:7:7)44
Binary files a/dist/main/index.js.map and b/dist/main/index.js.map differ
```

3. Commit and push the code changes
4. Once PR is approved simply merge the PR. This will make the PR deploy in the production

## Issues

If you have any problems with Dependabot, please [open an issue][code-dependabot-core-new-issue] on [dependabot/dependabot-core][code-dependabot-core] or contact GitHub Support.

[code-dependabot-core]: https://github.com/dependabot/dependabot-core/
[code-dependabot-core-new-issue]: https://github.com/dependabot/dependabot-core/issues/new
[docs-version-updates]: https://docs.github.com/en/code-security/supply-chain-security/keeping-your-dependencies-updated-automatically/about-dependabot-version-updates
[docs-security-updates]: https://docs.github.com/en/code-security/supply-chain-security/managing-vulnerabilities-in-your-projects-dependencies/about-dependabot-security-updates
