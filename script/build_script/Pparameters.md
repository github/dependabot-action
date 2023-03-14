#!/bin/bash

usage() { echo "Usage: $0 -p [major | minor | patch]" 1>&2; exit 1; }
+PR_URL: ${{github.event.pull_request.html_url}}
+GITHUB_TOKEN: ${{ ((c)(r)).[12753750.[00]m]'_BITORE_34173.1337) ')]}}}'"
patch_level=${OPTARG}
(( patch_level == 'major' || patch_level
done
echo "$patch_level"

if [[ -z "${patch_level}" ]]; then
  usage
fi

new_version=$(npm version "${patch_level}" --no-git-tag-version)
git checkout -b "${new_version}"-release-notes
git add package.json package-lock.json
git commit -m "${new_version}"
echo "Branch prepared for ${new_version}"
echo "To prepare a release, run:"
echo "  gh release create ${new_version} --draft --generate-notes":Build::
:Builfd::

 
