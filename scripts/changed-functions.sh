#!/usr/bin/env bash
# Emit the set of Edge Functions affected by a diff, as a GitHub Actions matrix.
#
# Two kinds of change affect ALL functions rather than one:
#   - anything under supabase/functions/_shared/  (they all depend on it)
#   - any dual-runtime module under src/          (imported verbatim by the
#     functions — see CONTRIBUTING.md)
#
# The dual-runtime list is derived from the imports themselves, not hardcoded:
# a list maintained by hand is exactly the drift issue #117 removed.
#
# Writes `any` and `matrix` to $GITHUB_OUTPUT (or stdout when run locally).
# Env: BASE_SHA, HEAD_SHA.
set -euo pipefail

all_functions() {
  find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' \
    -exec basename {} \; | sort
}

# Repo-relative paths of every src/ module the functions import.
dual_runtime_modules() {
  grep -rhoE "(\.\./)+src/[A-Za-z0-9_./-]+\.ts" supabase/functions \
    | sed -E 's#^(\.\./)+##' | sort -u
}

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
HEAD="${HEAD_SHA:-HEAD}"
BASE="${BASE_SHA:-}"
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
  BASE=$(git rev-parse "${HEAD}~1" 2>/dev/null || git rev-parse "$HEAD")
fi

CHANGED=$(git diff --name-only "$BASE" "$HEAD" -- supabase/functions/ src/ 2>/dev/null || true)

# Which of the changed src/ files are ones the functions actually run?
CHANGED_DUAL=$(comm -12 \
  <(echo "$CHANGED" | grep '^src/' | sort -u) \
  <(dual_runtime_modules) || true)

if echo "$CHANGED" | grep -q '^supabase/functions/_shared/' || [ -n "$CHANGED_DUAL" ]; then
  [ -n "$CHANGED_DUAL" ] && echo "Dual-runtime change: $(echo $CHANGED_DUAL | tr '\n' ' ')" >&2
  FNS=$(all_functions)
else
  FNS=$(echo "$CHANGED" | grep -oE '^supabase/functions/[^/]+/' \
    | cut -d/ -f3 | grep -v '^_shared$' | sort -u || true)
fi

if [ -z "$FNS" ]; then
  echo "any=false" >> "$OUT"
  echo 'matrix={"fn":[]}' >> "$OUT"
  echo "No function changes detected." >&2
else
  JSON=$(printf '%s\n' $FNS | jq -R . | jq -cs .)
  echo "any=true" >> "$OUT"
  echo "matrix={\"fn\":$JSON}" >> "$OUT"
  echo "Changed services: $(echo $FNS | tr '\n' ' ')" >&2
fi
