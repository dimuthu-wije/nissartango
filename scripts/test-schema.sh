#!/usr/bin/env bash
# ============================================================================
# test-schema.sh -- stage 1 + 2 suites against the LOCAL Supabase stack.
#
#   supabase start
#   ./scripts/test-schema.sh
#
# Sequence, and why:
#   db reset          -- migrations from scratch, then seed.sql
#   clear content     -- the suites build their own fixtures and assert on
#                        exact contents; on top of seed.sql the organizer
#                        slugs collide outright and every count is wrong
#   run both suites
#   clear + re-seed   -- leave the database in the state prove-rls.sh expects
#
# Then:  ./scripts/create-test-users.sh && ./scripts/prove-rls.sh
#
# Never point this at a hosted project: it truncates and resets.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source scripts/_db.sh

require_local "this RESETS the database and TRUNCATES its tables"

# Overridable so CI (or a test of this script) can skip the CLI step.
DB_RESET_CMD="${DB_RESET_CMD:-supabase db reset}"

echo "==> $DB_RESET_CMD"
$DB_RESET_CMD

# From here on the database is missing its seed rows, and prove-rls.sh needs
# them. Restore on the way out NO MATTER HOW WE LEAVE -- a failed assertion, a
# ^C, or an error in the clear step itself. Getting this wrong once already
# left a database empty and made the next script abort for the wrong reason.
SEED_RESTORED=0
restore_seed() {
  [[ "$SEED_RESTORED" == 1 ]] && return 0
  SEED_RESTORED=1
  echo
  echo "==> restoring seed.sql"
  db_clear_content   >/dev/null 2>&1 || true
  db_psql -q < supabase/seed.sql >/dev/null 2>&1 || echo "   (could not restore: run 'supabase db reset')"
}
trap restore_seed EXIT

echo "==> clearing seed rows so the suites are deterministic"
db_clear_content

failed=0
for suite in supabase/tests/schema_tests.sql supabase/tests/rls_tests.sql; do
  echo
  echo "==> $suite"
  out=$(mktemp)
  db_psql < "$suite" > "$out" 2>&1 || true

  sed -E 's/^psql:[^:]*:[0-9]+: //; s/^NOTICE:  //' "$out" \
    | grep -vE '^(SET|RESET|BEGIN|COMMIT|INSERT 0|UPDATE [0-9]|DELETE [0-9]|CREATE|DROP|DO|TRUNCATE|Pager| *(must_fail|check_eq|touched)|-+$|\(1 row\)|^ *$)' \
    || true

  # A suite stops at its first failed assertion, so the marker at the very end
  # is the only thing that means "all of it ran and all of it passed".
  if ! grep -q 'TESTS PASSED' "$out"; then
    failed=1
    echo "   ^^ this suite did NOT reach its PASSED marker"
  fi
  rm -f "$out"

  db_clear_content
done

restore_seed

echo
if [[ "$failed" -eq 0 ]]; then
  echo "Both suites ran. Look for 'ALL SCHEMA TESTS PASSED' and 'ALL RLS TESTS PASSED' above --"
  echo "any assertion that fails stops its suite at that point with an ERROR line."
else
  echo "A suite could not be run; see above."
  exit 1
fi
echo
echo "Next:  ./scripts/create-test-users.sh"
echo "       EDITOR_EMAIL=bob@example.org EDITOR_PASSWORD=practica-2026 ./scripts/prove-rls.sh"
