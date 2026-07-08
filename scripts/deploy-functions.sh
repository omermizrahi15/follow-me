#!/usr/bin/env bash
# Deploy all Edge Functions to a Supabase project with the correct JWT settings.
# Single source of truth for verify_jwt, used by CI (deploy-*.yml) and by hand.
#
#   Usage: SUPABASE_ACCESS_TOKEN=... scripts/deploy-functions.sh <project-ref>
#
# Note: `functions deploy <name>` only touches the named functions, so anything
# deployed out-of-band (e.g. prod's `view-post`, which has no source in this
# repo) is left untouched rather than removed.
set -euo pipefail

REF="${1:?usage: deploy-functions.sh <project-ref>}"

# Invoked by Twilio webhooks, pg_cron, or anon clients — no end-user JWT, so the
# platform gateway must NOT require one (the functions do their own auth checks).
NO_JWT=(join join-webhook subscribe auto-post send-post delete-candidates)

for fn in "${NO_JWT[@]}"; do
  echo "→ deploying $fn (no-verify-jwt)"
  supabase functions deploy "$fn" --project-ref "$REF" --no-verify-jwt
done

# classify-photos requires a signed-in user's JWT — keep the gateway check ON.
echo "→ deploying classify-photos (verify-jwt)"
supabase functions deploy classify-photos --project-ref "$REF"

echo "✅ Edge Functions deployed to $REF"
