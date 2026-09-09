#!/usr/bin/env bash
# Run the read-only database checks and FAIL if any of them says so.
#
# WHY THIS EXISTS. supabase/tests/grants_check.sql had a stale expectation from
# the day 20260831120000_content_checksum.sql was written -- that migration
# grants SELECT on a new view to anon, and check 1 enumerates anon's entire
# surface. Nobody noticed for eleven days, because the file had never been run.
# A test nobody runs is not coverage; it is a file that describes an intention.
#
#   npm run check:db              # the safe set, on every project configured
#   npm run check:db -- --prod-ddl   # ALSO probe production (see below)
#
# ---------------------------------------------------------------------------
# SPLIT BY BLAST RADIUS. The two files are not the same kind of thing.
# ---------------------------------------------------------------------------
#
#   grants_check.sql   PURE READS. Catalogue queries, no DDL, no writes. Run
#                      against dev AND production automatically, every time.
#
#   api_settings.sql   CREATES A TABLE. It is inside a transaction that always
#                      rolls back, and it has been verified to leave nothing
#                      behind -- but it is still DDL, and `npm run check` runs
#                      several times a day. Unattended DDL against the live
#                      database is not a thing to do by default, however
#                      carefully the transaction is written. So: dev
#                      automatically, production only when asked with
#                      --prod-ddl.
#
# The asymmetry is the point. If this file ever runs DDL against production
# without someone typing --prod-ddl, that is a bug.
set -uo pipefail
cd "$(dirname "$0")/.."

PROD_DDL=0
for a in "$@"; do [[ "$a" == "--prod-ddl" ]] && PROD_DDL=1; done

# --- .env -------------------------------------------------------------------
# PARSED, not sourced. `source .env` executes it, and a database password is
# exactly the kind of string that contains $ and backticks. The environment
# wins over the file, same precedence as scripts/fetch-content.mjs.
#
# Only these two keys are read. Everything else in .env is none of this
# script's business.
load_env() {
  [[ -f .env ]] || return 0
  local line k v
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*(DEV_DB_URL|PROD_DB_URL)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    v="${v%"${v##*[![:space:]]}"}"            # rtrim
    [[ "$v" == \"*\" || "$v" == \'*\' ]] && v="${v:1:${#v}-2}"
    [[ -n "${!k:-}" ]] && continue            # already exported: leave it
    printf -v "$k" '%s' "$v"; export "$k"
  done < .env
}
load_env

targets=()
[[ -n "${DEV_DB_URL:-}"  ]] && targets+=("dev")
[[ -n "${PROD_DB_URL:-}" ]] && targets+=("prod")

if [[ ${#targets[@]} -eq 0 ]]; then
  cat >&2 <<'MSG'

  ----------------------------------------------------------------------
  DATABASE CHECKS SKIPPED -- no DEV_DB_URL or PROD_DB_URL.

  The build and its output were verified; the DATABASE was not. Grants, RLS
  and the Data API settings are unchecked.

  Put them in .env, which is already gitignored and already holds keys. Use
  the SESSION POOLER URIs from Project Settings -> Database -> Connection
  string; the direct ones are IPv6-only on some networks.

      DEV_DB_URL=postgresql://postgres.hjsekipqryfuwdkhxuks:PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
      PROD_DB_URL=postgresql://postgres.eqcgeqzzuzcwrflwasjo:PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres

  That file now carries a credential with full database access, unlike the
  publishable key beside it. Confirm it is not readable by anyone else:

      chmod 600 .env && git check-ignore -v .env

  ----------------------------------------------------------------------

MSG
  exit 0
fi

command -v psql >/dev/null || {
  echo "psql is not installed. brew install libpq, then add it to PATH." >&2
  exit 1
}

ref_of() { printf '%s' "$1" | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p' | head -1; }

failed=0
ran=()
run_one() {   # <label> <url> <file>
  local label="$1" url="$2" f="$3" out ref
  ref="$(ref_of "$url")"
  echo
  echo "=== $f  ->  $label${ref:+ ($ref)}"
  out="$(PGOPTIONS='--client-min-messages=warning' \
         psql -X -q --pset=footer=off -v ON_ERROR_STOP=1 -f "$f" "$url" 2>&1)" || {
    echo "$out"; echo "  ERROR: could not run $f against $label" >&2; failed=1; return; }
  echo "$out"
  # api_settings.sql says LOOK AT THIS; grants_check.sql says *** FAIL ***.
  if grep -qE '\*\*\* FAIL \*\*\*|LOOK AT THIS|NO BASE TABLES' <<<"$out"; then
    echo "  ^^ $label FAILED $f" >&2
    failed=1
  fi
  ran+=("$label:$(basename "$f")")
}

# Read-only: everywhere, always.
for t in "${targets[@]}"; do
  url="DEV_DB_URL"; [[ "$t" == prod ]] && url="PROD_DB_URL"
  run_one "$t" "${!url}" supabase/tests/grants_check.sql
done

# DDL probe: dev always; production only on request.
[[ -n "${DEV_DB_URL:-}" ]] && run_one dev "$DEV_DB_URL" supabase/tests/api_settings.sql
if [[ -n "${PROD_DB_URL:-}" ]]; then
  if [[ $PROD_DDL -eq 1 ]]; then
    echo
    echo "--- --prod-ddl given: probing PRODUCTION. This creates a table inside a"
    echo "--- transaction that always rolls back."
    run_one prod "$PROD_DB_URL" supabase/tests/api_settings.sql
  else
    echo
    echo "note: api_settings.sql was NOT run against production (it creates a table)."
    echo "      When you want it:  npm run check:db -- --prod-ddl"
  fi
fi

echo
if [[ $failed -eq 0 ]]; then
  echo "database checks passed: ${ran[*]}"
else
  echo "DATABASE CHECKS FAILED -- see the rows marked above." >&2
fi
exit $failed
