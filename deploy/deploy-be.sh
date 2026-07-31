#!/usr/bin/env bash
# Lives at /opt/legallink/deploy-be.sh on the production server. Invoked by
# .github/workflows/deploy.yml over SSH, via the restricted deploy key whose
# forced command is /opt/legallink/deploy-dispatch.sh (see deploy-dispatch.sh
# in this same directory). This copy is the source of truth for review/history
# — after editing, copy it to the server and re-chmod +x.
set -euo pipefail

cd /opt/legallink/legallink-be

LOCK=/tmp/legallink-be-deploy.lock
exec 200>"$LOCK"
flock -n 200 || { echo "another deploy is already in progress"; exit 1; }

PREV_SHA=$(git rev-parse HEAD)
echo "current sha: $PREV_SHA"

git fetch origin production
NEW_SHA=$(git rev-parse origin/production)

if [ "$PREV_SHA" = "$NEW_SHA" ]; then
  echo "already up to date, nothing to deploy"
  exit 0
fi

echo "deploying $NEW_SHA"
git reset --hard "$NEW_SHA"

npm ci
npm run build

sudo systemctl restart legallink-be

echo "waiting for health check..."
OK=0
for i in $(seq 1 15); do
  sleep 2
  if curl -sf http://127.0.0.1:4000/api >/dev/null 2>&1; then
    OK=1
    break
  fi
done

if [ "$OK" != "1" ]; then
  echo "HEALTH CHECK FAILED — rolling back to $PREV_SHA"
  git reset --hard "$PREV_SHA"
  npm ci
  npm run build
  sudo systemctl restart legallink-be
  echo "rollback complete"
  exit 1
fi

echo "deploy succeeded: $NEW_SHA"
