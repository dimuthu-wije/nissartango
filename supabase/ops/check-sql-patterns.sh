#!/usr/bin/env bash
# ============================================================================
# supabase/ops/check-sql-patterns.sh
#
# Greps the ops and test SQL for two mistakes that have each been fixed in one
# file and left broken in another. Run it after fixing either one anywhere.
#
# ----------------------------------------------------------------------------
# WHY THIS FILE EXISTS
# ----------------------------------------------------------------------------
#
# Three times in two days, a correct fix failed to propagate across the file
# set, and each time the broken copy ran and failed:
#
#   2026-09-17  ORDER BY ... COLLATE after a set operation.
#               content_inventory.sql had the working subquery-wrapped form
#               while restore-content.sql and teardown-dev-rehearsal.sql had
#               the illegal one. Failed at step B4.
#
#   2026-09-17  psql variable interpolation inside a dollar-quoted block.
#               restore-content.sql had the set_config remedy, written the same
#               hour, with a comment explaining exactly this failure --
#               while teardown-dev-rehearsal.sql still had `:'uuidlist'` inside
#               do $$ ... $$. Failed at step G.
#
#   (and the same shape in filter-content-dump.sh, where a COPY pattern was
#   fixed in one of four places at a time.)
#
# The common factor is not carelessness about the fix. It is that the fix was
# written for the call site that failed, and nothing looked for the others. So
# the remedy is not "be careful": it is a grep that runs.
#
# Both checks are STATIC and cheap. Neither reaches a database. Run before
# handing any of these files to psql.
#
# Run:
#     ./supabase/ops/check-sql-patterns.sh
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
FILES=$(ls supabase/ops/*.sql supabase/tests/*.sql 2>/dev/null)
[ -n "$FILES" ] || { echo "no SQL files found" >&2; exit 2; }

fail=0

# --------------------------------------------------------------------------
# CHECK 1 -- ORDER BY <expr> after a set operation.
#
# ORDER BY following UNION/INTERSECT/EXCEPT accepts ONLY a bare output column
# name or an ordinal. `order by 1 collate "C"` and `order by tbl collate "C"`
# are both rejected at parse ANALYSIS -- they parse cleanly, so nothing static
# catches them and only a live server does. The legal form wraps the set
# operation in a subquery and sorts outside it.
#
# Heuristic: an `order by ... collate` whose statement also contains `union`.
# --------------------------------------------------------------------------
echo "== check 1: ORDER BY ... COLLATE after a set operation =="
for f in $FILES; do
  awk -v F="$f" '
    /^[[:space:]]*--/ { next }
    /[Uu][Nn][Ii][Oo][Nn]/ { seen_union = 1; depth_ok = 0 }
    /select \* from \(/   { wrapped = 1 }
    /[Oo][Rr][Dd][Ee][Rr] [Bb][Yy].*[Cc][Oo][Ll][Ll][Aa][Tt][Ee]/ {
      if (seen_union && !wrapped) { printf "  BROKEN %s:%d  %s\n", F, NR, $0; bad = 1 }
      seen_union = 0; wrapped = 0
    }
    /;[[:space:]]*$/ { seen_union = 0; wrapped = 0 }
    END { exit (bad ? 1 : 0) }
  ' "$f" || fail=1
done
[ "$fail" -eq 0 ] && echo "  clean"

# --------------------------------------------------------------------------
# CHECK 2 -- psql variable inside a dollar-quoted block.
#
# psql does not substitute :var or :'var' inside $$ ... $$. The server receives
# the literal text and raises `syntax error at or near ":"`. The remedy is to
# interpolate outside the block and read the value back with current_setting:
#
#     select set_config('ns.thing', :'thing', true);
#     do $$ begin ... current_setting('ns.thing') ... end; $$;
# --------------------------------------------------------------------------
echo "== check 2: psql variable inside a dollar-quoted block =="
python3 - $FILES <<'PY' || fail=1
import re, sys
bad = 0
for f in sys.argv[1:]:
    s = open(f).read()
    inside = [False] * len(s)
    for m in re.finditer(r'\$\$.*?\$\$', s, re.S):
        for i in range(m.start(), m.end()):
            inside[i] = True
    for m in re.finditer(r"(?<!:):'?\w+'?", s):
        if s[m.start()+1:m.start()+2] == ':':      # second colon of a :: cast
            continue
        ls = s.rfind('\n', 0, m.start()) + 1
        if s[ls:s.find('\n', m.start())].lstrip().startswith('--'):
            continue
        if inside[m.start()]:
            print(f"  BROKEN {f}:{s.count(chr(10), 0, m.start())+1}  {m.group(0)}"
                  f" — inside $$, will not interpolate")
            bad = 1
print("  clean" if not bad else "")
sys.exit(bad)
PY

exit "$fail"
