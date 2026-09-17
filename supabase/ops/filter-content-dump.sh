#!/usr/bin/env bash
# ============================================================================
# supabase/ops/filter-content-dump.sh
#
# Takes a `supabase db dump --data-only --use-copy --schema public` file and
# produces three things:
#
#   <dump>.filtered.sql     the same dump with public.organizers.email and
#                           .phone replaced by \N
#   <dump>.synthetic.sql    inserts for auth.users, one per uuid the dump
#                           references, derived FROM THE DUMP ITSELF
#   counts on stderr        how many email and phone values were redacted
#
# ----------------------------------------------------------------------------
# WHY THE REDACTION HAPPENS HERE AND NOT ANYWHERE ELSE
# ----------------------------------------------------------------------------
#
# public.organizers carries `email` and `phone`, both commented "PRIVATE. Never
# exposed to anon", both absent from organizers_public. A --schema public dump
# contains them. The rehearsal restores into hjsekipqryfuwdkhxuks, which is
# deliberately fail-open and is on the free tier, so it takes automated daily
# backups. Load those values and they are in dev's storage, in dev's WAL, and
# in Supabase's backups of dev -- and a truncate at teardown removes none of
# the last two.
#
# Three ways to avoid that were considered:
#
#   --exclude-table-data   drops the whole organizers table from the dump and
#                          takes the FK topology with it. The FK topology is
#                          the thing most likely to break a real restore and
#                          the reason the rehearsal targets dev's public schema
#                          at all. Rejected.
#
#   post-load UPDATE       commits the values first and nulls them second. The
#                          window is short and the WAL record is permanent.
#                          Rejected.
#
#   filter the dump        the values never reach the wire. Chosen.
#
# The cost is that F1 can no longer expect IDENTICAL. That cost is paid
# explicitly in the sequence: F1 now predicts DIFFERENT on exactly one cell,
# and a separate step proves the BACKUP is complete against the dump file. The
# weakening of F1 is visible, documented and reversible; PII in dev's automated
# backups is none of those. This project's tiebreaker has been
# irreversible-over-reversible since the free-text decision.
#
# NOTE THE ASYMMETRY, because it is the whole point: the UNFILTERED dump is
# what gets committed to the private backup repo. A backup with the contact
# details stripped out would not be a backup. Only the copy that touches dev is
# filtered. Do not "simplify" this by filtering at dump time.
#
# ----------------------------------------------------------------------------
# WHY THE SYNTHETIC USERS ARE DERIVED FROM THE DUMP
# ----------------------------------------------------------------------------
#
# organizer_members.user_id and user_roles.user_id are `not null references
# auth.users (id)`; events.created_by is nullable and references it too. Those
# are the only three FKs to auth.users in the schema. Restoring public into a
# project whose auth.users is empty fails on the first organizer_members row.
#
# The uuid set could be taken from production with a query (step D2 does
# exactly that). It is taken from the DUMP here instead, because the dump is
# what is actually being restored: a set queried from production a few minutes
# later can differ from the file, and then the restore fails for a reason that
# looks like a broken dump. D2 stays in the sequence as the cross-check -- the
# two sets must match, and if they do not, that is a finding about the window
# between them, not about this script.
#
# The synthetic rows carry uuids and NOTHING ELSE. No email address reaches dev
# by this path either. Same uuids-yes / emails-never split as D2.
#
# ----------------------------------------------------------------------------
# Run:
#     ./supabase/ops/filter-content-dump.sh ~/nissartango-backups/content-<ts>.sql
# ============================================================================
set -euo pipefail

DUMP="${1:-}"
[ -n "$DUMP" ] && [ -f "$DUMP" ] || {
  printf 'usage: %s <dump.sql>\n' "$0" >&2; exit 2; }

OUT="${DUMP%.sql}.filtered.sql"
SYN="${DUMP%.sql}.synthetic.sql"

# --------------------------------------------------------------------------
# Nothing this script writes survives a failure.
#
# Measured 2026-09-17: when the inner awk exited non-zero, `set -e` aborted the
# script BEFORE the explicit `rm` in the post-check, leaving a half-filtered
# .filtered.sql on disk. A partially-redacted file that looks like a finished
# one is worse than no file, because the next step is to point psql at it.
#
# The trap covers every exit path including ones added later. It is disarmed
# only after the post-check has passed.
# --------------------------------------------------------------------------
_ok=0
_cleanup() {
  rc=$?
  if [ "$_ok" -ne 1 ]; then
    rm -f "$OUT" "$SYN" "$OUT.stats"
    [ "$rc" -ne 0 ] && printf 'cleaned up partial output; nothing written.\n' >&2
  fi
  exit "$rc"
}
trap _cleanup EXIT

# --------------------------------------------------------------------------
# GUARD 1 -- the dump must not carry its own transaction control.
#
# restore-content.sql wraps the load in a single transaction so that a failure
# leaves dev untouched. A COMMIT inside the dump would end that transaction
# early and a BEGIN would nest. The previous draft of the sequence handled this
# by having a human read `head -40` and choose a wrapper. A guard is better:
# it cannot be skipped and it cannot misread.
# --------------------------------------------------------------------------
if grep -nE '^[[:space:]]*(BEGIN|START TRANSACTION|COMMIT|END)[[:space:]]*;' "$DUMP"; then
  printf '\nREFUSING: dump contains its own transaction control (lines above).\n' >&2
  printf 'restore-content.sql assumes it owns the transaction. Stop and re-read.\n' >&2
  exit 1
fi

# --------------------------------------------------------------------------
# GUARD 2 -- session_replication_role is STRIPPED, not refused, and the strip
# is reported.
#
# Measured 2026-09-17: line 1 of a real `supabase db dump --data-only` is
#     SET session_replication_role = replica;
# so pg_dump does the trigger handling itself. The previous version of this
# guard refused on that and was right to notice -- but refusing means the
# normal dump can never be restored, and relaxing it would mean the op's
# behaviour is decided by a file it received rather than by the op.
#
# So: strip every such line and report how many. restore-content.sql then owns
# the setting through its own -v replica branch, which is exactly the fallback
# that matters -- if the postgres role cannot set session_replication_role
# (probe B1), the dump's own line would abort the restore on line 1 with no
# alternative, whereas the op's per-table branch still works. Deferring to the
# dump would delete the only path that survives a failed B1.
# --------------------------------------------------------------------------
N_SRR=$(grep -cE 'session_replication_role' "$DUMP" || true)
if [ "$N_SRR" -gt 0 ]; then
  grep -nE 'session_replication_role' "$DUMP" >&2
  printf 'stripping %s session_replication_role line(s); restore-content.sql owns this setting\n' "$N_SRR" >&2
fi

# --------------------------------------------------------------------------
# GUARD 3 -- no auth or storage data. supabase db dump excludes Supabase-
# managed schemas, so this should find nothing; it is asserted rather than
# assumed because the whole identity design rests on it.
#
# Pattern tolerates QUOTED identifiers. A real dump emits
#     COPY "public"."organizers" ("id", "name", ...) FROM stdin;
# and the unquoted-only pattern this guard used before matched none of it --
# returning 0 hits and reading as a pass for the wrong reason.
# --------------------------------------------------------------------------
if grep -nE '^COPY +"?(auth|storage)"?\.' "$DUMP"; then
  printf '\nREFUSING: dump carries auth or storage data (lines above).\n' >&2
  exit 1
fi

# --------------------------------------------------------------------------
# The filter itself.
#
# Column positions are PARSED from each COPY header rather than hard-coded.
# A hard-coded position silently redacts the wrong column the day someone adds
# a column to organizers, and the wrong column would be redacted into dev
# without anything failing.
# --------------------------------------------------------------------------
awk -v syn="$SYN" '
  BEGIN { OFS = "\t"; incopy = 0; n_email = 0; n_phone = 0; n_copy = 0; n_srr = 0 }

  # Drop any session_replication_role line; restore-content.sql owns it.
  /session_replication_role/ { n_srr++; next }

  # COPY public.<table> (col, ...) FROM stdin;   -- quoted OR unquoted.
  # A real supabase db dump emits every identifier quoted:
  #   COPY "public"."organizers" ("id", "name", ...) FROM stdin;
  # The unquoted-only pattern this used before matched NOTHING on a real dump,
  # and matching nothing made every downstream test vacuously pass.
  /^COPY +"?public"?\."?[A-Za-z_][A-Za-z0-9_]*"? *\(.*\) +FROM stdin;$/ {
    n_copy++
    tbl = $0
    sub(/^COPY +/, "", tbl); sub(/ *\(.*$/, "", tbl)
    gsub(/"/, "", tbl); sub(/^public\./, "", tbl)

    cols = $0; sub(/^[^(]*\(/, "", cols); sub(/\) +FROM stdin;$/, "", cols)
    gsub(/"/, "", cols); gsub(/ /, "", cols)
    ncol = split(cols, c, ",")
    delete idx
    for (i = 1; i <= ncol; i++) idx[c[i]] = i
    incopy = 1
    print
    next
  }

  incopy && /^\\\.$/ { incopy = 0; print; next }

  incopy {
    nf = split($0, f, "\t")

    if (tbl == "organizers") {
      if (!(("email" in idx) && ("phone" in idx))) {
        print "REFUSING: organizers COPY header has no email/phone column" > "/dev/stderr"
        exit 1
      }
      seen_organizer_rows = 1
      if (f[idx["email"]] != "\\N") { n_email++; f[idx["email"]] = "\\N" }
      if (f[idx["phone"]] != "\\N") { n_phone++; f[idx["phone"]] = "\\N" }
    }

    # Collect every uuid that references auth.users.
    if (tbl == "organizer_members" && ("user_id"    in idx)) u[f[idx["user_id"]]]    = 1
    if (tbl == "user_roles"        && ("user_id"    in idx)) u[f[idx["user_id"]]]    = 1
    if (tbl == "events"            && ("created_by" in idx) && f[idx["created_by"]] != "\\N")
                                                             u[f[idx["created_by"]]] = 1

    line = f[1]
    for (i = 2; i <= nf; i++) line = line OFS f[i]
    print line
    next
  }

  { print }

  END {
    print "-- Synthetic auth.users rows, derived from the dump this sits beside." > syn
    print "-- uuids only. No email, no phone, no credential material." > syn
    print "-- The column list below is the one probe B2 confirmed writable;" > syn
    print "-- if B2 named more required columns, add them HERE and nowhere else." > syn
    n = 0
    for (k in u) {
      printf "insert into auth.users (id, instance_id, aud, role, email)\n" > syn
      printf "values (%c%s%c, %c00000000-0000-0000-0000-000000000000%c, %cauthenticated%c, %cauthenticated%c, null)\n", \
             39, k, 39, 39, 39, 39, 39, 39, 39 > syn
      printf "on conflict (id) do nothing;\n" > syn
      n++
    }
    # ZERO IS THE EXPECTED CASE TODAY, not a failure. As measured 2026-09-17,
    # production has organizer_members = 0, user_roles = 0 and no non-null
    # created_by, so the dump references auth.users zero times. The file is then
    # comment-only and `\i` on it is a no-op, which is exactly right. Say so in
    # the file itself, so nobody opening an empty synthetic.sql concludes the
    # script failed.
    if (n == 0) {
      print "-- 0 synthetic rows: this dump references auth.users zero times." > syn
      print "-- Expected while no organizer has signed up. Not an error." > syn
    }
    printf "-- %d synthetic rows\n", n > syn
    printf "copy_blocks=%d\nstripped_srr_lines=%d\norganizer_rows_seen=%d\n", \
           n_copy, n_srr, (seen_organizer_rows ? 1 : 0) > "/dev/stderr"
    printf "redacted_email_values=%d\nredacted_phone_values=%d\nsynthetic_uuids=%d\n", \
           n_email, n_phone, n > "/dev/stderr"
  }
' "$DUMP" > "$OUT" 2> "$OUT.stats"
cat "$OUT.stats" >&2

copy_blocks=$(sed -n 's/^copy_blocks=//p' "$OUT.stats")

# --------------------------------------------------------------------------
# A FILTER THAT MATCHED NOTHING MUST NEVER REPORT SUCCESS.
#
# This is the guard the previous version did not have, and its absence was the
# actual bug on 2026-09-17: the COPY pattern failed to match a real dump, so
# `incopy` never set, `bad` never set, and the post-check below concluded that
# no contact detail had survived -- from a file it had never looked inside.
# A false pass inside the guard written to prevent a false pass.
#
# Every downstream check here is of the form "did something bad survive?".
# Every one of them answers NO when nothing was examined. So the number of
# blocks examined has to be asserted FIRST and positively, before any absence
# is allowed to mean anything.
# --------------------------------------------------------------------------
if [ "${copy_blocks:-0}" -ne 5 ]; then
  printf '\nREFUSING: matched %s COPY blocks, expected 5.\n' "${copy_blocks:-0}" >&2
  printf 'Expected: events, event_exceptions, organizers, organizer_members, user_roles.\n' >&2
  printf '0 means the COPY header pattern does not match this dump -- check quoting.\n' >&2
  rm -f "$OUT" "$SYN" "$OUT.stats"
  exit 1
fi
rm -f "$OUT.stats"

printf 'filtered -> %s\n' "$OUT"
printf 'synthetic -> %s\n' "$SYN"

# --------------------------------------------------------------------------
# Prove the filter worked, on the file, before anybody points psql at dev.
#
# Rewritten to POSITIVE assertions with distinct exit codes. The previous
# version used `exit (bad ? 0 : 1)` so that the shell `if` read naturally --
# clever, and it meant "found nothing" and "examined nothing" produced the same
# answer. Three outcomes are now distinguished by code, and the default is
# refusal rather than success:
#
#   0  the organizers block was found, rows were examined, none carried a value
#   2  no organizers COPY block matched at all      -> refuse
#   3  a value survived                             -> refuse
# --------------------------------------------------------------------------
if awk '
  /^COPY +"?public"?\."?organizers"? *\(.*\) +FROM stdin;$/ {
    cols = $0; sub(/^[^(]*\(/, "", cols); sub(/\) +FROM stdin;$/, "", cols)
    gsub(/"/, "", cols); gsub(/ /, "", cols)
    n = split(cols, c, ","); for (i = 1; i <= n; i++) idx[c[i]] = i
    found = 1; incopy = 1; next
  }
  incopy && /^\\\.$/ { incopy = 0; next }
  incopy {
    split($0, f, "\t")
    if (f[idx["email"]] != "\\N" || f[idx["phone"]] != "\\N") bad = 1
  }
  END {
    if (!found) { print "post-check: no organizers COPY block in the filtered file" > "/dev/stderr"; exit 2 }
    if (bad)    { print "post-check: an email or phone value survived"              > "/dev/stderr"; exit 3 }
    exit 0
  }
' "$OUT"; then
  _ok=1
  printf 'verified: organizers block examined, no email or phone value survives\n'
else
  printf '\nREFUSING: post-check failed (see reason above).\n' >&2
  exit 1
fi
