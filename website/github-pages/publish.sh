#!/usr/bin/env bash
# Publishes the website's pages to a GitHub repo that serves them with GitHub
# Pages (a repo of its own, so Scorpion's update repository, which the main repo
# publishes with Pages, is left alone).
#
#   bash website/github-pages/publish.sh https://github.com/OWNER/REPO.git
#
# Run it again after any change to the website. It copies the pages and assets,
# not the server code (api, lib), the Docker files or the Hugging Face Space
# files, and pushes to the repo's main branch.
set -euo pipefail

repo="${1:?usage: publish.sh <repo url>}"
here="$(cd "$(dirname "$0")" && pwd)"
site="$(dirname "$here")"
work="$(mktemp -d)"

git clone "$repo" "$work"
cd "$work"
git checkout -B main
rm -rf site .github
mkdir -p site .github/workflows

tar -C "$site" \
  --exclude=./api --exclude=./lib --exclude=./hf-space --exclude=./github-pages \
  --exclude=./node_modules --exclude=./Dockerfile --exclude=./.dockerignore \
  --exclude=./dev-server.mjs --exclude=./package.json --exclude=./.env.example \
  --exclude=./README.md -cf - . | tar -C site -xf -
touch site/.nojekyll
cp "$here/pages.yml" .github/workflows/pages.yml
cp "$here/REPO-README.md" README.md

git config user.email '274588930+dmotionstudio-stack@users.noreply.github.com'
git config user.name 'Scorpion'
git add -A
git commit -m 'Scorpion website' || echo 'Nothing new to publish.'
git push origin HEAD:main
echo "Published to $repo"
