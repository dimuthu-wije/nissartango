# Design spec — nissartango

Written 2026-10-09, before any CSS changed. Nothing in `src/` or `editor/`
implements this yet; the only thing on disk is `design/brand/`.

In English, like the rest of `docs/` and unlike the two guides: this is a build
document for whoever writes the CSS, not an operating guide for the person who
runs the site. `docs/GUIDE-admin.md` and `editor/public/aide/` stay French for
the opposite reason.

**Every contrast ratio below was computed, not estimated.** Where a value came
from the reference rather than from a measurement it says so, because two of
the reference's own colours fail in the roles it assigns them.

---

## The voice

A printed programme on warm paper: one weight of type, hairline rules, colour
rationed to a single warm accent, and nothing decorative standing between the
reader and the next milonga.

---

## Where it comes from, and what was NOT taken

Reference: **Art In DUMBO**, refero style `5d79f0c2-526e-4c37-b780-08404f60839b`
— "gallery broadside on raw paper". It is a dense editorial listing system, not
a marketing page, which is why it transplants at all.

**Taken:** one weight at every size; structure from hairline rules rather than
cards, shadows or coloured panels; rationed colour; left-aligned everything;
the list row as the primary content unit; deliberate radius contrast.

**Not taken, deliberately:**

- **Its palette values.** Pure `#000000` on pure `#ffffff` with a sage-green
  accent. Our ink, paper and accent are warm and come from the logo.
- **Its sage green.** There is no reason to import a colour from a Brooklyn
  gallery when the identity already has one. See *Open questions*.
- **Its photography strategy.** It leans on full-bleed documentary photography
  to carry atmosphere. We have event flyers — posters, not photographs — and
  only some events have one. The hero is solved differently, or not at all.
- **Its display scale.** 63–68px headings and 80–120px section gaps are a
  landing page's proportions. See *Density*.
- **Its contrast failures.** Measured below.
- Its layout, components, copy and wordmark.

Refero derives these specs from screenshots. It describes what that site **did**;
it does not validate it. Treat every number in it as a claim, not a measurement.

---

## 1. Colour

All values measured against the surface they sit on. **AA body** is 4.5:1,
required for anything text-sized including small uppercase labels. **AA large**
is 3:1, which also covers UI boundaries and graphics.

### Light

| Token | Value | On paper | For |
|---|---|---|---|
| `--paper` | `#FBFAF8` | — | page canvas |
| `--linen` | `#EFEBE4` | 1.14:1 | quiet section bands, non-text |
| `--ink` | `#171614` | **17.34:1** | all primary text, from the logo |
| `--muted` | `#6B6660` | **5.45:1** | meta, labels, secondary text |
| `--rule` | `#DED8CF` | 1.36:1 | hairline between rows |
| `--rule-strong` | `#B8B0A4` | 2.06:1 | section and block dividers |
| `--accent` | `#D85A30` | 3.71:1 | the logo orange — fills and graphics only |
| `--accent-text` | `#BF4F2A` | **4.61:1** | the accent wherever it is TEXT |

### Dark

Derived here; the reference is light-only (`Theme: light`) and offers nothing
for this. Values chosen to match the editor's existing dark tokens.

| Token | Value | On paper | For |
|---|---|---|---|
| `--paper` | `#171614` | — | page canvas (also the logo's ink) |
| `--linen` | `#201E1B` | 1.09:1 | section bands |
| `--ink` | `#FBFAF8` | **17.34:1** | primary text |
| `--muted` | `#A39D94` | **6.72:1** | meta, secondary |
| `--rule` | `#332F2A` | 1.36:1 | row hairline |
| `--rule-strong` | `#4E4842` | 2.01:1 | section dividers |
| `--accent` | `#D85A30` | **4.67:1** | unchanged — it already clears AA on ink |
| `--accent-text` | `#D85A30` | **4.67:1** | same; no darkened variant needed |

### Rules

1. **`--accent` is never used for text.** At 3.71:1 on paper it fails AA. Use
   `--accent-text` (`#BF4F2A`) for the format label, links, and any other
   coloured lettering. It is the brand orange scaled to 88% — identical hue,
   the lightest value that clears 4.5:1. In dark mode the two are the same
   colour, because the orange already passes on ink.

2. **The CTA is an orange fill with an INK label, not a cream one.** Measured:
   cream `#FBFAF8` on `#D85A30` is **3.71:1 — fails**; ink `#171614` on the same
   fill is **4.67:1 — passes**. Today `[slug].astro` sets `color: #fff` on the
   accent-filled button, so this is a real change, not a restatement. The
   reference reaches the same conclusion for its own pill ("it must remain
   #000000").

3. **Cancellation is structural, not chromatic.** Today it is `#b3261e` red.
   Red sits one hue away from the brand orange and the two will muddy each
   other wherever they meet. The strikethrough, the dimming and the word
   **Annulé** already carry the meaning — the reference's whole instinct is that
   structure does this work, not colour. Drop the red; keep `--ink` for the
   word and let the line through the title do the rest.

4. **Colour is rationed.** The accent marks the format label, links, and the one
   CTA. Nothing else is coloured. No coloured panels, no gradients, no tinted
   cards.

### Two reference colours that must NOT be copied

| Reference token, in its stated role | On its own white | |
|---|---|---|
| Ember `#ff7f41` as **urgency text** ("Closing Soon") | **2.51:1** | fails AA and AA-large |
| Ash `#bdbdbd` as **meta text** (open hours) | **1.88:1** | fails AA and AA-large |

Ash maps onto our venue / price / organizer line — the most-scanned secondary
text on the page. Ember maps onto **Annulé**, the single most useful thing the
agenda can say about a regular. Both are replaced by `--muted` (5.45:1) and
`--ink` respectively.

---

## 2. Type

**Inter**, self-hosted. The reference specifies Helvetica Neue and names Inter
first among its sanctioned substitutes; Inter is SIL OFL, free, and drawn for
screens.

    font-family: Inter, "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;

**One weight: 500.** This is the reference's signature — "not bold, not regular,
never thin" — and it is also a real simplification here: the site currently uses
600 and 700 across nine rules in four files. Hierarchy comes from size, colour and space.

**Self-hosted `.woff2`** — DONE 2026-10-09, generated by
`scripts/make-fonts.mjs` and served from `/fonts/` by both deployments. Not
Google's CDN: hotlinking it puts an EU IP transfer in front of every visitor,
and this site needs no cookie banner today precisely because it does nothing
of the kind.

Two faces, 24KB each, `font-display: swap`. Only the 500 is preloaded — it is
the only weight the system uses and every page sets it. The 600 has its own
`@font-face` and is therefore **not downloaded at all** on a page with no
`<strong>` in it; verified in the browser, which reported `Inter 500 loaded,
Inter 600 unloaded`.

**One known gap: `Ÿ` (U+0178)**, which lives in `latin-ext`. The declared
range covers every other accented letter French uses, plus `« » · ’ € œ Œ`.
Ÿ occurs in French essentially only in all-caps proper nouns — L'HAŸ-LES-ROSES
— and covering it would mean a second subset for every visitor. When it does
occur the browser falls back for that one glyph, to Helvetica Neue, which is
the face the reference specifies anyway. Asserted both ways in
`tests/fonts.test.js`: the required set must stay covered, and Ÿ must stay
uncovered, so that if the subset ever changes the comments saying this get
fixed.

### Scale

Ten ad-hoc sizes currently exist between 0.7 and 1.9rem, four of which are
visually indistinguishable. This replaces them. Every size below is drawn from
the reference's own measured ramp.

| Token | px | rem | For |
|---|---|---|---|
| `--text-label` | 11 | 0.6875 | uppercase format eyebrow |
| `--text-body` | 16 | 1 | body, row meta, dates, times |
| `--text-row` | 19 | 1.1875 | event title in a listing row |
| `--text-sub` | 22 | 1.375 | subheadings, prose h2 |
| `--text-head` | 34 | 2.125 | page titles |
| `--text-display` | 63 | 3.9375 | reserved; not used by the agenda |

Line height: 1.5 at body sizes, 1.15 at `--text-head` and above.

**One documented responsive step.** Under 40rem, `--text-head` drops from 34px
to 28px. 34px is a desktop measurement, and at 375px a long event title — tango
titles are long — took three lines of it. 28px is also on the reference's own
ramp, so this steps down the scale rather than inventing a size off it. It is
the only size that changes with the viewport; everything else holds.

**Measure.** Prose caps at `34rem` (~65 characters). Listing rows do not — they
are a table, not prose.

---

## 3. Space

Base unit **4px**, as the reference. Scale: `4 · 8 · 12 · 16 · 20 · 24 · 32 ·
48 · 64 · 96`.

Section gap **48–64px**, not the reference's 80–120px. See *Density*.

---

## 4. Shape

- **Radius contrast is deliberate**, as the reference: pill controls at `999px`,
  everything else at `2px`. Never an in-between value.
- Flyers and thumbnails: `4px` maximum.
- **No shadows anywhere.** The reference defines two and then says not to use
  them for separation; we have nothing that needs them. Separation is a rule or
  a shift to `--linen`.
- Hairlines are `1px solid var(--rule)` between rows, `var(--rule-strong)`
  between sections.

**Why not the reference's solid black hairlines.** Its exhibition list shows
about ten rows. At ~200 events a year this agenda will show dozens, and a black
rule between every one of them stops reading as structure and starts reading as
a cage. Two weights of rule — strong for sections, quiet for rows — is the
honest translation of "structure comes from rules, not shadows."

---

## 5. Layout

| | Value | Note |
|---|---|---|
| shell max-width | `64rem` (1024px) | reference says 1200px; see below |
| prose max-width | `34rem` | reading measure |
| gutter | `24px`, `16px` under 40rem | |

The reference's 1200px suits four columns of meta plus an 80px thumbnail. Ours
carries four short fields and no thumbnail, and at 1200px the row goes sparse
and the eye has to travel. 64rem is a starting value to tune against real rows
at implementation — not a measured result.

Everything is left-aligned. Nothing is centred.

---

## 6. Density — the rule that governs the translation

**Take the reference's voice; keep the agenda's density.**

A weekly practica is furniture and a festival is news; the two-section split in
`src/lib/occurrences.js` already encodes that. The style must not undo it by
turning each row into a card. Concretely:

- **A row stays a row.** Grid, one hairline, meta on one line. It takes the
  reference's type, colour and rhythm — not its spacing.
- **Two type sizes per row**, per the reference's own rule: `--text-row` for the
  title, `--text-body` for everything else. The agenda row currently stacks
  five.
  **Documented exception:** the format eyebrow stays at `--text-label` (11px),
  making three. It is a tag, not prose — a different register — and at 16px
  uppercase it competes with the title it sits above. The reference's own
  example row also uses three sizes, so the rule is a guideline it does not
  itself keep.
- **The page title and section openers take the full scale.** That is where a
  style announces itself and it costs no density.
- **The format eyebrow is where the accent earns its keep.** It is the only
  repeated colour on the page; today it is nearly invisible.
- **Flyers get space on the event page.** Real posters, currently full width
  with a 4px radius and nothing else.
- **One row per EVENT, not per date.** A non-recurring event that runs over
  several days collapses to a single row carrying a range — "du samedi 14 au
  lundi 16 novembre 2026". Measured: a three-day festival had been filling
  three byte-identical rows. This is the reference's own "date range" column,
  and it is the second time the same lesson has been learned here: the first
  was a weekly milonga occupying eight rows, which is why `sections()` exists.
  An exceptional date of a SERIES is never folded — that one exception is the
  only time a regular appears chronologically, and collapsing it would undo
  the thing the split is for.
- **A status is a stamp, not a colour.** **ANNULÉ** in tracked uppercase ink,
  the note muted beside it. The accent is already spent on the eyebrow two
  lines above and a second warm colour muddies against it.

---

## 7. Dark mode

Derived above; the reference has none. **CSS only, via `prefers-color-scheme`,
with no toggle** — see *Constraints*. The editor already works this way, so the
two deployments will behave alike for the first time.

The logo handles this with one file: `design/brand/logo-wordmark.svg` has its
two ink paths as `currentColor` and keeps the orange literal, so it follows the
theme while the ART stays orange. The orange is the one thing that does not
flip, and does not need to — 3.71:1 on paper and 4.67:1 on ink, both above the
3:1 bar that applies to a graphic.

---

## 8. Constraints this design must live inside

1. **Zero client JavaScript, enforced.** `verify-build.mjs` check 3 fails the
   build on any `.js` in `dist/` and on any `<script>` that is not `ld+json`.
   No theme toggle, no JS nav, no scroll animation, no `<ClientRouter>`.
2. **Agenda rows must stay `<li>` carrying `data-event` and `data-date`.**
   Check 9 parses them out of `index.html` and fails if none are emitted.
3. **Every event page must stay reachable** from `/` or `/archives/` (check 8b),
   and every page keeps its canonical and og:image (checks 4, 4b).
4. ~~The favicon and the social card are generated and committed.~~ **DONE
   2026-10-09.** Both generators read `design/brand/` rather than holding
   their own copy of the mark and the accent. Re-run them by hand after any
   change to the logo or the palette; nothing tests that the committed output
   is current.
5. ~~`#a01b2e` appears in four files.~~ **DONE** — it appears in none. The
   old maroon is gone from source and from committed output alike.

---

## 9. Open questions

1. **The wordmark's typeface is unidentified.** The lettering is outlined, so
   the logo needs no licence and this blocks nothing — but if the mark is ever
   registered as a trademark, get the name first, since a few EULAs restrict
   outlines in a registered mark. Ask the session that drew it. An attempt to
   identify it locally was abandoned: the renderer here does not resolve font
   families, and the comparison would have been fabricated.
2. ~~Sage, or no sage.~~ **DECIDED 2026-10-09: no sage.** One brand colour,
   rationed, with `--accent-text` where contrast demands it. The reference
   reserves a green for its single filled CTA and the orange for urgency text;
   ours does both jobs. Adding green would have meant importing a colour the
   identity does not have, to obey a rule written for a site that does. There
   is accordingly no green anywhere in `src/styles/tokens.css`.
3. ~~Shell width.~~ **SETTLED 2026-10-09 at 64rem**, by rendering a synthetic
   sixteen-event agenda rather than arguing about two. At two rows the
   hairlines ran ~150px past the longest title and the measure looked too
   wide; at sixteen, with real venue, price and organizer strings, it reads
   correctly. The sparseness was an artifact of the sample.
4. **Prose is defined but barely proven.** Both event bodies in production are
   plain paragraphs, so `p` is the only element real content exercises.
   Headings, lists, blockquotes and rules are derived from the scale and have
   never been seen against anything. Check them against a real article before
   trusting them.
