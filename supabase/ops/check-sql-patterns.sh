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
# ----------------------------------------------------------------------------
# THIS FILE FAILED ITS OWN FIRST FULL RUN, AND THE FAILURES WERE FALSE
# ----------------------------------------------------------------------------
#
# Check 2 was written and tested against supabase/ops/, which has no time
# literals. On its first run over supabase/tests/ it reported five BROKEN lines
# on a repo that was entirely correct -- `:30` and `:00` out of '16:30:00+00'
# and '2026-10-01 20:00+02' inside DO blocks. Fixed by requiring a variable name
# to start with [A-Za-z_], which a time fragment never does.
#
# It matters out of proportion to its size. This runs at step A8, ahead of
# everything else, so as first written it would have failed the first step of
# every future rehearsal on a clean tree. A check that cries wolf gets switched
# off -- which is the warning-nobody-reads failure, recreated by the tool built
# to prevent it. Two rounds earlier the lesson was that a check which cannot
# fail proves nothing; this is the other half, that a check which always fails
# stops being read.
#
# A second defect surfaced in the same sitting: a `$$` inside a COMMENT was
# paired as a real delimiter, shifting every region after it and producing both
# a missed hit and a false one. Comments are masked before pairing now.
#
# Verified against six discrimination cases and the real nine-file set: a
# quoted variable inside `$$`, a bare one inside `$$`, one inside a tagged
# `$func$` block -- all flagged; a `::` cast, a time literal inside `$$`, and a
# variable correctly placed OUTSIDE a block -- all silent.
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

# Comments are blanked (to spaces, preserving offsets) BEFORE anything else.
#
# A `$$` inside a comment would otherwise be paired as a real delimiter and
# shift every region after it by one, so a variable inside a genuine block reads
# as outside and a variable outside reads as inside. Both directions of wrong
# answer, from prose. These files are heavily commented and several of them
# discuss dollar-quoting by name, so this is likely rather than theoretical --
# it happened on the first six-case test.
#
# KNOWN LIMIT, stated because a clean pass will now be trusted: a `$$` inside a
# single-quoted string literal is still paired as a delimiter. Nothing in this
# repo does that today. Blanking string literals as well would be wrong here,
# because `:'var'` is a psql construct whose quotes are not a string.
def mask_comments(s):
    out = list(s)
    for m in re.finditer(r'--[^\n]*', s):
        for i in range(m.start(), m.end()):
            out[i] = ' '
    for m in re.finditer(r'/\*.*?\*/', s, re.S):
        for i in range(m.start(), m.end()):
            if out[i] != '\n':
                out[i] = ' '
    return ''.join(out)

# Dollar-quoted regions, TAGGED OR BARE. `$$ ... $$` and `$func$ ... $func$`
# both count; an earlier version paired only bare `$$`, so a tagged block was
# invisible and a variable inside one would have passed silently.
def dollar_regions(s):
    spans, i = [], 0
    while True:
        m = re.compile(r'\$(\w*)\$').search(s, i)
        if not m:
            return spans
        tag = m.group(0)
        end = s.find(tag, m.end())
        end = len(s) if end == -1 else end + len(tag)
        spans.append((m.start(), end))
        i = end

# A psql variable name cannot start with a digit. Requiring [A-Za-z_] as the
# first character is what keeps TIME LITERALS out: in '20:00+02' the colon is
# followed by a digit. The earlier \w+ form matched `:00` and `:30`, and this
# check failed on five lines of supabase/tests/ the first time it saw them --
# on a repo that was entirely correct.
#
# That matters more than its size. This runs at A8, before everything else, so
# a false positive here means the first step of every rehearsal fails on a clean
# tree. A check that cries wolf gets switched off, which is the
# warning-nobody-reads failure recreated by the tool built to prevent it. The
# other half of the lesson from two rounds ago: a check that cannot fail proves
# nothing, and a check that always fails stops being read.
VAR = re.compile(r"(?<!:):'?[A-Za-z_]\w*'?")

bad = 0
for f in sys.argv[1:]:
    raw = open(f).read()
    s = mask_comments(raw)
    inside = [False] * len(s)
    for a, b in dollar_regions(s):
        for i in range(a, b):
            inside[i] = True
    for m in VAR.finditer(s):
        if s[m.start()+1:m.start()+2] == ':':      # second colon of a :: cast
            continue
        if inside[m.start()]:
            print(f"  BROKEN {f}:{s.count(chr(10), 0, m.start())+1}  {m.group(0)}"
                  f" — inside a dollar-quoted block, will not interpolate")
            bad = 1
print("  clean" if not bad else "")
sys.exit(bad)
PY

exit "$fail"
