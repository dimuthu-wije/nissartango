#!/usr/bin/env bash
# ============================================================================
# create-test-users.sh -- the two accounts prove-rls.sh needs, on the LOCAL
# stack only. Reads its own credentials from `supabase status`; nothing here
# is meant to be copied and pasted with a placeholder in it.
#
#   supabase start && supabase db reset
#   ./scripts/create-test-users.sh
#
# Creates bob@example.org (owner of Nissartango) and dave@example.org (admin),
# then wires them up as postgres -- organizer_members and user_roles are
# unreachable from any user token by design, so this is DB-side work.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source scripts/_db.sh

: "${API_URL:?supabase status gave no API_URL -- is the stack running?}"
: "${ANON_KEY:?supabase status gave no ANON_KEY}"

require_local "this DELETES AND RECREATES user accounts"

# GoTrue owns password hashing, so we never write encrypted_password ourselves.
# If an account already exists with a password we do not know -- which is what
# happens when auth.users survives a db reset -- we delete the row and let
# signup recreate it. Deleting a user cascades to organizer_members and
# user_roles, which is why the wiring below runs afterwards, every time.
signup() {
  curl -s "$API_URL/auth/v1/signup" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}"
}

can_sign_in() {
  curl -s "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | grep -q access_token
}

ensure_user() {
  local email="$1" password="$2" out
  out=$(signup "$email" "$password")

  case "$out" in
    *already*registered*|*23505*|*user_already_exists*)
      if can_sign_in "$email" "$password"; then
        echo "   $email already exists, password matches"
        return 0
      fi
      echo "   $email exists with an unknown password -- recreating it"
      db_psql -q -c "delete from auth.users where email = '$email';" </dev/null
      out=$(signup "$email" "$password")
      ;;
  esac

  # Never take signup's word for it: prove the credential works.
  if can_sign_in "$email" "$password"; then
    echo "   $email ready"
  else
    echo "   $email CANNOT sign in." >&2
    echo "   signup said: $out" >&2
    echo "   if that mentions confirmation, set enable_confirmations = false" >&2
    echo "   under [auth.email] in supabase/config.toml and reset." >&2
    exit 1
  fi
}

echo "==> creating accounts"
ensure_user bob@example.org  practica-2026
ensure_user dave@example.org milonga-2026

echo "==> wiring them up"
db_psql -q <<'SQL'
insert into public.organizer_members (organizer_id, user_id, role)
select '0a000000-0000-0000-0000-0000000000aa', id, 'owner'
  from auth.users where email = 'bob@example.org'
on conflict (organizer_id, user_id) do update set role = 'owner';

insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'dave@example.org'
on conflict do nothing;

select u.email,
       coalesce(m.role::text, r.role::text, '-- not wired --') as granted
  from auth.users u
  left join public.organizer_members m on m.user_id = u.id
  left join public.user_roles r        on r.user_id = u.id
 where u.email in ('bob@example.org', 'dave@example.org');
SQL

echo
echo "Now:  ./scripts/prove-rls.sh"
echo "      (EDITOR_EMAIL=bob@example.org EDITOR_PASSWORD=practica-2026 for the logged-in half)"
