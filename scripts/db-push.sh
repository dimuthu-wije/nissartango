#!/usr/bin/env bash
# Apply pending migrations to a HOSTED project, naming the ref out loud first.
#
#     ./scripts/db-push.sh dev  --dry-run
#     ./scripts/db-push.sh dev
#     ./scripts/db-push.sh prod --dry-run
#     ./scripts/db-push.sh prod
#
# WHY THIS EXISTS RATHER THAN `supabase db push`.
#
# 1. A bare `supabase db push` targets whatever is LINKED, and on 2026-09-19
#    that was eqcgeqzzuzcwrflwasjo -- production. Someone intending to try a
#    migration on dev first would have applied it to production and been told
#    "Finished supabase db push." The two project NAMES are backwards
#    (PROJECT_SETUP.md), so the linked ref is not something to infer. This
#    script prints the ref it is about to touch, before it touches it.
#
# 2. --db-url wants the connection string on the command line, which puts the
#    database password in shell history and in `ps`. Here it is read from .env
#    into a variable and never printed. It is still visible in `ps` for the
#    seconds the CLI runs; that is a property of the flag, not of this script.
#
# .env is PARSED, not sourced -- same reason as scripts/check-db.sh: a database
# password is exactly the kind of string that contains $ and backticks, and
# `source` would execute them.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-}"
shift || true
case "$target" in
  dev)  key=DEV_DB_URL ;;
  prod) key=PROD_DB_URL ;;
  *) echo "usage: $0 dev|prod [--dry-run] [other supabase db push flags]" >&2; exit 2 ;;
esac

url=""
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*(DEV_DB_URL|PROD_DB_URL)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    [[ "${BASH_REMATCH[1]}" == "$key" ]] || continue
    v="${BASH_REMATCH[2]}"
    v="${v%"${v##*[![:space:]]}"}"                       # rtrim
    [[ "$v" == \"*\" || "$v" == \'*\' ]] && v="${v:1:${#v}-2}"
    url="$v"
  done < .env
fi
# The environment wins over the file, same precedence as check-db.sh.
[[ -n "${!key:-}" ]] && url="${!key}"

if [[ -z "$url" ]]; then
  echo "no $key in .env or the environment. See .env.example." >&2
  exit 3
fi

# The ref, from the connection string itself rather than from the argument.
# "dev" is what you asked for; this is what you are actually about to change.
ref=$(printf '%s' "$url" | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p' | head -1)
[[ -n "$ref" ]] || { echo "could not read a project ref out of $key" >&2; exit 4; }

prod_ref=$(cat data/production-ref 2>/dev/null | tr -d '[:space:]')
label="dev"
[[ "$ref" == "$prod_ref" ]] && label="*** PRODUCTION ***"

echo
echo "  target:  $target"
echo "  ref:     $ref   $label"
echo "  linked:  $(cat supabase/.temp/project-ref 2>/dev/null || echo 'not linked') (NOT used -- this pushes by --db-url)"
echo

exec supabase db push --db-url "$url" "$@"
