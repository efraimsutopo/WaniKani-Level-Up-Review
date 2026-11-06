#!/bin/sh
set -eu

case "$#:${1-}" in
  0:|1:--resume) ;;
  *)
    echo 'Usage: npm run deploy [-- --resume]' >&2
    exit 1
    ;;
esac

if [ "$(git branch --show-current)" != main ]; then
  echo 'Switch to main before deploying.' >&2
  exit 1
fi

if [ "${1-}" != --resume ]; then
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m 'chore: save changes before deploy'
  fi

  npm run version:patch
  version=$(node -p 'require("./package.json").version')
  git add -- package.json package-lock.json
  git commit -m "chore: release v$version"
else
  version=$(node -p 'require("./package.json").version')
  if [ -n "$(git status --porcelain)" ] ||
    [ "$(git log -1 --format=%s)" != "chore: release v$version" ]; then
    echo 'To resume, main must be clean and point to the release commit.' >&2
    exit 1
  fi
fi

if ! npm run build || ! git push origin main || ! gh-pages -d dist; then
  echo 'After fixing the error, run npm run deploy -- --resume to retry this version.' >&2
  exit 1
fi
