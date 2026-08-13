#!/usr/bin/env bash
# Deploy Edge Functions to a Supabase project with the correct per-function
# verify_jwt setting. Single source of truth, used by CI (deploy-services.yml)
# and by hand. Deploys ONE, SOME, or ALL functions — the unit of deployment is
# a single service.
#
#   scripts/deploy-functions.sh <project-ref>                 # all repo functions
#   scripts/deploy-functions.sh <project-ref> send-post       # just one
#   scripts/deploy-functions.sh <project-ref> join send-post  # a subset
#
# Requires SUPABASE_ACCESS_TOKEN in the environment.
set -euo pipefail

# --use-api is load-bearing, not an optimisation. The default deploy path bundles
# in Docker and cannot follow a relative import out of supabase/ — and since
# issue #117 every function imports the app's dual-runtime modules from src/.
# The API bundler resolves them; the Docker one fails the deploy.
#
# It also removes the reason this script is called one function at a time: the
# 2026-08-02 incident where three concurrent Docker deploys reported success and
# silently kept their old bundles was a race the server-side bundler doesn't have.
USE_API=--use-api

REF="${1:?usage: deploy-functions.sh <project-ref> [function...]}"
shift || true

# Functions invoked by Twilio webhooks, pg_cron, or anon clients carry no
# end-user JWT, so the platform gateway must not require one (they do their own
# auth). MUST match supabase/config.toml. Anything NOT listed keeps the default
# gateway JWT check ON — that's correct for classify-photos, send-post and
# delete-candidates, which are all called WITH a valid JWT (user or anon key).
NO_JWT=" join join-webhook subscribe auto-post twilio-status "

# No names given → every function that has source in this repo.
if [ "$#" -eq 0 ]; then
  set -- $(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' -exec basename {} \;)
fi

for fn in "$@"; do
  if [ ! -f "supabase/functions/$fn/index.ts" ]; then
    echo "⚠️  skip $fn — no supabase/functions/$fn/index.ts in repo"
    continue
  fi
  if [[ "$NO_JWT" == *" $fn "* ]]; then
    echo "→ $fn (no-verify-jwt)"
    supabase functions deploy "$fn" --project-ref "$REF" $USE_API --no-verify-jwt
  else
    echo "→ $fn (verify-jwt)"
    supabase functions deploy "$fn" --project-ref "$REF" $USE_API
  fi
done

echo "✅ deployed to $REF: $*"
