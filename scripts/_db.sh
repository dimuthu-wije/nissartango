# shellcheck shell=bash
# ============================================================================
# _db.sh -- sourced by the other scripts. Two jobs:
#
#   1. Resolve API_URL / ANON_KEY / DB_URL from `supabase status`, so no script
#      in this repo asks you to paste a credential.
#   2. Provide db_psql, which works whether or not libpq is on your PATH --
#      the Supabase CLI does not install psql, so on a clean Mac it is missing.
#      Falls back to the psql inside the stack's own database container.
#
# db_psql always reads SQL from stdin (the container has no access to your
# filesystem, so `-f somefile.sql` cannot work on the fallback path).
# ============================================================================

if [[ -z "${DB_URL:-}" || -z "${API_URL:-}" || -z "${ANON_KEY:-}" ]]; then
  if command -v supabase >/dev/null 2>&1; then
    while IFS='=' read -r _k _v; do
      _v="${_v%\"}"; _v="${_v#\"}"
      case "$_k" in
        API_URL)  API_URL="${API_URL:-$_v}"   ;;
        ANON_KEY|PUBLISHABLE_KEY) ANON_KEY="${ANON_KEY:-$_v}" ;;
        DB_URL)   DB_URL="${DB_URL:-$_v}"     ;;
      esac
    done < <(supabase status -o env 2>/dev/null)
  fi
fi

# ---------------------------------------------------------------------------
# require_local <what this script does>
#
# These scripts truncate tables and delete accounts, and they take their target
# from environment variables. One wrong `export` is all it takes. Every
# destructive script calls this, and it checks BOTH addresses -- the API and
# the database -- because they are set independently: a local API_URL with a
# hosted DB_URL would still truncate the hosted database.
#
# ALLOW_NON_LOCAL=1 overrides, deliberately verbose, deliberately not a flag
# you would type by accident.
# ---------------------------------------------------------------------------
require_local() {
  local what="${1:-this script}" bad=()

  case "${API_URL:-}" in
    ''|http://127.0.0.1:*|http://localhost:*) ;;
    *) bad+=("API_URL=$API_URL") ;;
  esac

  # A DB_URL is only safe if it points at the loopback address. When it is
  # empty, db_psql uses the local stack's own container, which cannot be
  # anything but local.
  case "${DB_URL:-}" in
    ''|*@127.0.0.1:*|*@localhost:*|*host=/*) ;;
    *) bad+=("DB_URL=${DB_URL%%\?*}") ;;
  esac

  if [[ ${#bad[@]} -gt 0 ]]; then
    if [[ "${ALLOW_NON_LOCAL:-}" == "1" ]]; then
      echo
      echo "!!  ALLOW_NON_LOCAL=1 -- $what against a NON-LOCAL target:"
      printf '!!    %s\n' "${bad[@]}"
      echo "!!  You have 5 seconds to press ^C."
      sleep 5
    else
      echo "refusing to run: $what, and the target is not local." >&2
      printf '  %s\n' "${bad[@]}" >&2
      echo "  Start the local stack (supabase start), or set ALLOW_NON_LOCAL=1" >&2
      echo "  if you genuinely mean to do this to a hosted project." >&2
      exit 2
    fi
  fi
}

db_container() {
  docker ps --filter 'name=supabase_db_' --format '{{.Names}}' 2>/dev/null | head -1
}

db_psql() {
  if command -v psql >/dev/null 2>&1 && [[ -n "${DB_URL:-}" ]]; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
  else
    local c; c=$(db_container)
    if [[ -z "$c" ]]; then
      echo "no psql on PATH and no supabase_db container running -- is the stack up?" >&2
      return 2
    fi
    docker exec -i "$c" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}

# The test suites build their own fixtures and assert on exact contents, so
# they must not run on top of seed.sql -- the organizer slugs collide, and the
# counts would be wrong even where they did not. Clearing first is what makes
# the suites deterministic; test-schema.sh puts the seed back afterwards.
db_clear_content() {
  db_psql -q <<'SQL'
truncate table public.event_exceptions,
               public.events,
               public.organizer_members,
               public.user_roles,
               public.organizers
  restart identity cascade;
SQL
}

# NOTE: storage.objects is deliberately NOT cleared here. Supabase Storage
# installs a storage.protect_delete() trigger that refuses direct DELETE --
# those rows are metadata for files in the object store, and deleting one
# behind Storage's back orphans the file. `supabase db reset` recreates the
# database, so storage starts empty on every run of test-schema.sh anyway;
# the row rls_tests.sql inserts is cleaned up by the next reset. Removing an
# object for real means the Storage API, not SQL.
