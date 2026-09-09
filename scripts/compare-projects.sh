#!/usr/bin/env bash
# Run one of the read-only check files against TWO projects and diff the output.
#
# The comparison is the point. A single project's grants_check output tells you
# it passed its own thirteen assertions; two outputs side by side tell you
# whether the two projects are actually the same shape -- which is the only
# question that matters once one of them is production and the other is where
# you try things first.
#
#   ./scripts/compare-projects.sh supabase/tests/grants_check.sql "$DEV_DB_URL" "$PROD_DB_URL"
#   ./scripts/compare-projects.sh supabase/tests/api_settings.sql "$DEV_DB_URL" "$PROD_DB_URL"
#
# Connection strings come from the dashboard: Project Settings -> Database ->
# Connection string -> URI. Pass them as arguments or set DEV_DB_URL and
# PROD_DB_URL. They contain the database password, so keep them out of history:
#   read -rs DEV_DB_URL; export DEV_DB_URL
set -euo pipefail

SQL_FILE="${1:-}"
A_URL="${2:-${DEV_DB_URL:-}}"
B_URL="${3:-${PROD_DB_URL:-}}"

die() { printf '\n%s\n\n' "$*" >&2; exit 1; }

[ -n "$SQL_FILE" ] && [ -n "$A_URL" ] && [ -n "$B_URL" ] || die \
"usage: $0 <sql-file> <first-db-url> <second-db-url>

  or set DEV_DB_URL and PROD_DB_URL and pass only the sql file."

# Only the read-only check files. This script points at PRODUCTION by design,
# so it must not be a way to run arbitrary SQL there by pasting a path.
case "$SQL_FILE" in
  supabase/tests/*.sql) ;;
  *) die "refusing to run '$SQL_FILE' against a hosted project.
Only files in supabase/tests/ are allowed here -- those are the read-only ones." ;;
esac
[ -f "$SQL_FILE" ] || die "no such file: $SQL_FILE"

command -v psql >/dev/null || die "psql is not installed. brew install libpq (then add it to PATH)."

# A ref is public; a password is not. Label the columns by ref, never by URL.
ref_of() { printf '%s' "$1" | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p' | head -1; }
A_REF="$(ref_of "$A_URL")"; A_REF="${A_REF:-first}"
B_REF="$(ref_of "$B_URL")"; B_REF="${B_REF:-second}"

[ "$A_URL" = "$B_URL" ] && die "both connection strings are the same. Nothing to compare."
[ "$A_REF" = "$B_REF" ] && [ "$A_REF" != "first" ] && \
  die "both connection strings name $A_REF. Nothing to compare."

run() {
  # -X ignores ~/.psqlrc, so someone's local settings cannot change the output.
  # Trailing whitespace and the row-count footer are noise; the ref itself is
  # substituted out so two identical projects diff to nothing.
  PGOPTIONS='--client-min-messages=warning' \
  psql -X -q -A -F'|' --pset=footer=off -v ON_ERROR_STOP=1 -f "$SQL_FILE" "$1" \
    | sed -e 's/[[:space:]]*$//' -e "s/$2/<ref>/g"
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "running $SQL_FILE against $A_REF ..." >&2
run "$A_URL" "$A_REF" > "$TMP/a" || die "failed against $A_REF"
echo "running $SQL_FILE against $B_REF ..." >&2
run "$B_URL" "$B_REF" > "$TMP/b" || die "failed against $B_REF"

echo
if diff -u --label "$A_REF" "$TMP/a" --label "$B_REF" "$TMP/b" > "$TMP/d"; then
  echo "IDENTICAL — $A_REF and $B_REF agree on every line of $(basename "$SQL_FILE")"
  echo
  cat "$TMP/a"
  exit 0
fi

echo "DIFFERENT — $A_REF vs $B_REF"
echo
cat "$TMP/d"
echo
echo "A difference is not automatically a bug: content differs between projects"
echo "by design. A difference in GRANTS, RLS or default privileges is."
exit 1
