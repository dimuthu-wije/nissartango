#!/usr/bin/env bash
# ============================================================================
# prove-rls.sh -- the same proofs as supabase/tests/rls_tests.sql, but over
# HTTP against a real PostgREST + Storage, with the anon key an attacker would
# have.
#
#   ./scripts/prove-rls.sh                    # reads `supabase status` itself
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... ./scripts/prove-rls.sh
#
# For the logged-in half, set EDITOR_EMAIL / EDITOR_PASSWORD (see
# supabase/seed.sql for the two signup commands).
#
# Never run this against production: it attempts writes.
#
# ---------------------------------------------------------------------------
# A NOTE ON WHY THIS SCRIPT IS SO SUSPICIOUS OF ITSELF
#
# The first version of it "passed" 13 assertions against a database it had
# never authenticated to: every refusal it checked for was satisfied by a 401
# caused by a malformed key. A proof that passes when the credential is
# garbage proves nothing, and it fails in the safe-looking direction -- green.
#
# So, three rules here:
#   1. The key is validated as a JWT, and a positive control runs FIRST. If
#      the anon key cannot read a public row, we abort rather than report.
#   2. A refusal only counts if it is a PERMISSION refusal. PostgREST's
#      PGRST301/PGRST302 (JWT problems) are recorded as INVALID, never as ok.
#   3. An assertion that something is ABSENT from a response requires that
#      response to have been a 200 with rows in it. Absence from an error
#      body is not evidence.
# ============================================================================
set -uo pipefail

# --- credentials -----------------------------------------------------------
# Read them from the running stack unless they were passed in. This is also
# why the instructions no longer contain a copy-pasteable placeholder.
if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" \
      || "${SUPABASE_ANON_KEY:-}" == "..." || "${SUPABASE_URL:-}" == "..." ]]; then
  if command -v supabase >/dev/null 2>&1; then
    while IFS='=' read -r k v; do
      v="${v%\"}"; v="${v#\"}"
      case "$k" in
        API_URL)  SUPABASE_URL="${v}" ;;
        ANON_KEY) SUPABASE_ANON_KEY="${v}" ;;
      esac
    done < <(supabase status -o env 2>/dev/null)
  fi
fi

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"

abort() { printf '\n\033[31mABORTED\033[0m %s\n' "$1"; exit 2; }

[[ -n "$SUPABASE_URL" ]]      || abort "no SUPABASE_URL. Start the stack (supabase start) or export it."
[[ -n "$SUPABASE_ANON_KEY" ]] || abort "no SUPABASE_ANON_KEY. Start the stack (supabase start) or export it."

# Two key formats are in circulation: the legacy anon JWT (three dot-separated
# parts) and the newer publishable key (sb_publishable_...). Accept both, and
# refuse a secret key outright -- running these proofs with one would make
# every "refused" check pass, because nothing would be refused.
case "$SUPABASE_ANON_KEY" in
  sb_secret_*|*service_role*)
    abort "that is a SECRET key. These proofs are about what the PUBLIC key can
        reach; a secret key bypasses RLS entirely and would report a clean
        bill of health for a database with no protection at all." ;;
  sb_publishable_*) ;;
  *.*.*) ;;
  *)
    abort "SUPABASE_ANON_KEY is neither a JWT nor an sb_publishable_ key
        (got: '${SUPABASE_ANON_KEY:0:24}'...).
        A malformed key makes every request 401, which would make this
        script's refusal checks pass for entirely the wrong reason.
        Get the real one with:  supabase status" ;;
esac

# This script attempts writes -- every one of them is supposed to be refused,
# but "supposed to" is what we are here to find out. Against a hosted project
# it is a deliberate act, not a default.
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    if [[ "${ALLOW_NON_LOCAL:-}" == "1" ]]; then
      echo
      echo "!!  running the proofs against a NON-LOCAL project: $SUPABASE_URL"
      echo "!!  every write below is expected to be refused; if one is not,"
      echo "!!  it will have written to that project. ^C within 5 seconds."
      sleep 5
    else
      abort "refusing to run against $SUPABASE_URL.
        The proofs attempt writes. Set ALLOW_NON_LOCAL=1 to run them
        against a hosted project on purpose -- which is worth doing once,
        after the first push, since local cannot tell you how the real
        platform behaves."
    fi
    ;;
esac

REST="$SUPABASE_URL/rest/v1"
AUTH="$SUPABASE_URL/auth/v1"
STORAGE="$SUPABASE_URL/storage/v1"
BODY=/tmp/rls_body.$$
trap 'rm -f "$BODY"' EXIT

pass=0; fail=0; LAST_CODE=000
green()  { printf '\033[32mok  \033[0m %s\n' "$1"; pass=$((pass+1)); }
red()    { printf '\033[31mFAIL\033[0m %s\n       %s\n' "$1" "$2"; fail=$((fail+1)); }
purple() { printf '\033[35mVOID\033[0m %s\n       %s\n' "$1" "$2"; fail=$((fail+1)); }

req() { LAST_CODE=$(curl -s -o "$BODY" -w '%{http_code}' "$@"); }
body() { head -c 220 "$BODY"; }

# Did this response fail because of the CREDENTIAL rather than a policy?
credential_error() {
  grep -qi 'PGRST30[12]\|JWT\|invalid claim\|invalid signature\|"code":"401"' "$BODY"
}
has_rows() { [[ "$LAST_CODE" == 200 ]] && grep -q '^\s*\[\s*{' "$BODY"; }

# assert_ok <label> <curl args...>
assert_ok() {
  local label="$1"; shift; req "$@"
  if [[ "$LAST_CODE" == 200 ]]; then green "$label  [200]"
  else red "$label" "expected 200, got $LAST_CODE: $(body)"; fi
}

# assert_refused <label> <status-regex> <curl args...>
# A refusal only counts if it is about PERMISSION, not about the key.
assert_refused() {
  local label="$1" want="$2"; shift 2; req "$@"
  if credential_error; then
    purple "$label" "refused for the wrong reason (credential, not policy): $(body)"
  elif [[ "$LAST_CODE" =~ $want ]]; then
    green "$label  [$LAST_CODE]"
  else
    red "$label" "expected $want, got $LAST_CODE: $(body)"
  fi
}

# refute_body <label> <grep args...> -- only meaningful on a 200 WITH rows
refute_body() {
  local label="$1"; shift
  if ! has_rows; then
    purple "$label" "vacuous: last response was $LAST_CODE with no rows -- nothing to be absent from"
  elif grep -q "$@" "$BODY"; then
    red "$label" "LEAKED: $(body)"
  else
    green "$label"
  fi
}
assert_contains() {
  local label="$1"; shift
  if grep -q "$@" "$BODY"; then green "$label"; else red "$label" "body: $(body)"; fi
}

anon=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY")

# ===========================================================================
# PREFLIGHT. Nothing below is trustworthy unless this works.
# ===========================================================================
echo "=== preflight: the anon key can read published data ==="
req "${anon[@]}" "$REST/events_public?select=id,title&limit=5"
if [[ "$LAST_CODE" != 200 ]]; then
  abort "the anon key cannot read events_public (HTTP $LAST_CODE).
        $(body)
        Fix this before reading anything below: with a key the API rejects,
        every 'refused' check would pass for the wrong reason."
fi
if ! has_rows; then
  abort "events_public is empty, so the 'no pending events / no phone numbers'
        checks would pass vacuously. Run: supabase db reset  (applies seed.sql)"
fi
green "anon reads events_public, and it has rows"

echo
echo "=== as anon: the key that ships in the build, and in anyone's devtools ==="

assert_refused "GET /events is refused"              '^(401|403|404)$' "${anon[@]}" "$REST/events?select=*"
assert_refused "GET /organizers is refused"          '^(401|403|404)$' "${anon[@]}" "$REST/organizers?select=*"
assert_refused "GET /organizer_members is refused"   '^(401|403|404)$' "${anon[@]}" "$REST/organizer_members?select=*"
assert_refused "GET /user_roles is refused"          '^(401|403|404)$' "${anon[@]}" "$REST/user_roles?select=*"
assert_refused "RPC is_admin is refused"             '^(400|401|403|404)$' -X POST "${anon[@]}" \
  -H 'Content-Type: application/json' -d '{}' "$REST/rpc/is_admin"

assert_ok      "GET /events_public?select=*"         "${anon[@]}" "$REST/events_public?select=*"
assert_contains "...and it really is the agenda"     -i "starts_at"
refute_body    "no pending events in the payload"    -i '"status"'
refute_body    "no review notes in the payload"      -i "review_note"

assert_ok      "GET /organizers_public?select=*"     "${anon[@]}" "$REST/organizers_public?select=*"
assert_contains "...with organizers actually in it"  -i "nissartango"
refute_body    "no email address in the payload"     -F "@"
refute_body    "no phone number in the payload"      -E "\+33|0[1-9]([ .-]?[0-9]{2}){4}"

assert_refused "asking for phone explicitly fails"   '^(400|403)$' "${anon[@]}" "$REST/organizers_public?select=id,phone"
assert_contains "...because the column is not there" -i "does not exist\|42703\|PGRST"
assert_refused "asking for email explicitly fails"   '^(400|403)$' "${anon[@]}" "$REST/organizers_public?select=id,email"

assert_refused "anon cannot insert an event"         '^(401|403|404|405)$' -X POST "${anon[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Pirate","type":"cours","starts_at":"2026-12-01T20:00:00+01:00"}' "$REST/events"
assert_refused "anon cannot insert through the view" '^(401|403|404|405)$' -X POST "${anon[@]}" \
  -H 'Content-Type: application/json' -d '{"title":"Pirate"}' "$REST/events_public"
assert_refused "anon cannot call approve_event"      '^(400|401|403|404)$' -X POST "${anon[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"p_event":"00000000-0000-0000-0000-000000000000"}' "$REST/rpc/approve_event"

echo
echo "=== storage ==="
assert_ok      "anon may list the image bucket"      -X POST "${anon[@]}" \
  -H 'Content-Type: application/json' -d '{"prefix":"","limit":5}' "$STORAGE/object/list/event-images"
# The public endpoint takes no key, so the credential guard does not apply --
# and the status code alone is not evidence: a PUBLIC bucket missing an object
# answers 400 too. The distinguishing fact is WHICH thing was not found.
# Private bucket -> "Bucket not found". Public bucket -> "Object not found".
req "$SUPABASE_URL/storage/v1/object/public/event-images/anything.jpg"
if grep -qi 'bucket not found' "$BODY"; then
  green "the bucket is not public  [$LAST_CODE]"
elif grep -qi 'object not found' "$BODY"; then
  red "the bucket is not public" "the bucket IS public -- it answered 'Object not found', meaning it looked inside: $(body)"
else
  red "the bucket is not public" "unrecognised answer, check by hand: $LAST_CODE $(body)"
fi
assert_refused "anon cannot upload"                  '^(400|401|403)$' -X POST "${anon[@]}" \
  -H 'Content-Type: image/jpeg' --data-binary 'not-an-image' \
  "$STORAGE/object/event-images/00000000-0000-0000-0000-000000000000/x/pirate.jpg"

# ===========================================================================
if [[ -z "${EDITOR_EMAIL:-}" || -z "${EDITOR_PASSWORD:-}" ]]; then
  echo
  echo "(logged-in proofs skipped: set EDITOR_EMAIL and EDITOR_PASSWORD)"
else
  echo
  echo "=== as a logged-in editor ==="
  req -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EDITOR_EMAIL\",\"password\":\"$EDITOR_PASSWORD\"}" \
      "$AUTH/token?grant_type=password"
  EDITOR_JWT=$(sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BODY")

  if [[ -z "$EDITOR_JWT" ]]; then
    red "editor sign-in ($EDITOR_EMAIL)" "HTTP $LAST_CODE: $(body)
       -> if this says 'Invalid login credentials', the account does not exist yet:
          run the two signup commands documented in supabase/seed.sql."
  else
    green "editor signed in"
    ed=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $EDITOR_JWT")

    # Second preflight, same principle as the first. An account with no
    # organizer membership sees an empty table for entirely legitimate
    # reasons, and then every "cannot see other organizers" check below would
    # pass by seeing nothing at all.
    req "${ed[@]}" "$REST/organizers?select=id,name"
    if ! has_rows; then
      purple "editor setup" "$EDITOR_EMAIL belongs to no organizer (HTTP $LAST_CODE, $(body)).
       The checks below would pass by seeing nothing, so they are skipped.
       Fix with: ./scripts/create-test-users.sh"
      EDITOR_JWT=""
    fi
  fi

  if [[ -n "$EDITOR_JWT" ]]; then
    assert_ok      "editor reads the events table"    "${ed[@]}" "$REST/events?select=id,title,status,organizer_id"
    assert_contains "...and sees their own rows"      -i "status"
    refute_body    "...but not another organizer's"   -i "Rosa"

    assert_refused "editor cannot set status"         '^(400|403)$' -X POST "${ed[@]}" \
      -H 'Content-Type: application/json' \
      -d '{"title":"Auto-publiée","type":"cours","starts_at":"2026-12-01T20:00:00+01:00","status":"approved","organizer_id":"0a000000-0000-0000-0000-0000000000aa"}' \
      "$REST/events"
    assert_contains "...refused on the column"        -i "status\|permission denied\|42501"

    # The founding leak, end to end: create a real draft, try to publish it,
    # read it back, clean up. An insert refused on the column proves the grant
    # works; this proves the grant is the only way in AND that the legitimate
    # path still functions.
    req -X POST "${ed[@]}" -H 'Content-Type: application/json' \
        -H 'Prefer: return=representation' \
        -d '{"title":"Preuve (brouillon)","type":"cours","starts_at":"2026-12-01T20:00:00+01:00","organizer_id":"0a000000-0000-0000-0000-0000000000aa"}' \
        "$REST/events"
    if [[ "$LAST_CODE" == 201 ]]; then
      green "editor creates a draft  [201]"
      assert_contains "...which lands as pending"     -E '"status": *"pending"' 
      DRAFT_ID=$(sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' "$BODY" | head -1)
    else
      red "editor creates a draft" "expected 201, got $LAST_CODE: $(body)"
      DRAFT_ID=""
    fi

    if [[ -n "$DRAFT_ID" ]]; then
      assert_refused "editor cannot PATCH it to approved" '^(400|403)$' \
        -X PATCH "${ed[@]}" -H 'Content-Type: application/json' \
        -d '{"status":"approved"}' "$REST/events?id=eq.$DRAFT_ID"
      assert_contains "...refused on the status column"  -i "status\|permission denied\|42501"

      # Read it back. The refusal above could be a lie if the write landed.
      assert_ok      "the draft is still pending"        "${ed[@]}" \
        "$REST/events?id=eq.$DRAFT_ID&select=status"
      assert_contains "...verified by reading it back"   -E '"status": *"pending"' 

      assert_refused "nor sneak it in via review_note"   '^(400|403)$' \
        -X PATCH "${ed[@]}" -H 'Content-Type: application/json' \
        -d '{"review_note":"approuvez svp"}' "$REST/events?id=eq.$DRAFT_ID"

      req -X DELETE "${ed[@]}" "$REST/events?id=eq.$DRAFT_ID"
      if [[ "$LAST_CODE" =~ ^(200|204)$ ]]; then
        green "editor deletes their own draft  [$LAST_CODE]"
      else
        red "editor deletes their own draft" "expected 204, got $LAST_CODE: $(body)
       NOTE: a row named 'Preuve (brouillon)' may be left behind."
      fi
    fi

    assert_refused "editor cannot approve"            '^(400|401|403)$' -X POST "${ed[@]}" \
      -H 'Content-Type: application/json' \
      -d '{"p_event":"e0000000-0000-0000-0000-00000000000c"}' "$REST/rpc/approve_event"
    assert_contains "...with a clear refusal"         -i "not authorised\|42501"

    assert_refused "editor cannot read user_roles"    '^(401|403|404)$' "${ed[@]}" "$REST/user_roles?select=*"

    assert_ok      "editor reads organizers"          "${ed[@]}" "$REST/organizers?select=name,phone"
    refute_body    "...only their own organizer"      -i "Rosa"
  fi
fi

echo
echo "----------------------------------------"
printf '%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
