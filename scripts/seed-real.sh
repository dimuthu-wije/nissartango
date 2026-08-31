#!/usr/bin/env bash
# ============================================================================
# seed-real.sh -- put the REAL events into the local database.
#
#   supabase db reset      # migrations + supabase/seed.sql (the test fixtures)
#   ./scripts/seed-real.sh # then the real content on top
#
# It CLEARS the fixtures first, so local ends up with exactly what the hosted
# project holds -- four events, three organizers, one exception. Layering the
# real content on top of seed.sql instead would leave local with eight events
# and the hosted project with four, which is a different flavour of the same
# divergence this is meant to prevent.
#
# That means the two local states are deliberate and mutually exclusive:
#
#   supabase db reset                              -> fixtures, for the RLS
#   ./scripts/create-test-users.sh                    proofs (bob is wired to
#   ./scripts/prove-rls.sh                            organizer 0a000000-…-aa,
#                                                     which only seed.sql has)
#
#   supabase db reset && npm run seed:real         -> the real agenda, matching
#   npm run check                                     the hosted project
#
# Local only: initial-content.sql is idempotent, but nothing here should ever
# be pointed at a hosted project by accident. Run it there through the SQL
# editor, where you can see what you are doing.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source scripts/_db.sh

require_local "this writes content into the database"

echo "==> clearing the fixtures seed.sql left behind"
db_clear_content

echo "==> data/initial-content.sql"
db_psql < data/initial-content.sql
