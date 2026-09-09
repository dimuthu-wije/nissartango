/**
 * Which snapshot file belongs to which project.
 *
 * data/snapshot.json is PRODUCTION's, it is committed, and it is the backup
 * for content hand-entered over years — it is also what `--from-snapshot`
 * publishes in an emergency. Any other project writes data/snapshot.<ref>.json
 * instead, which .gitignore covers.
 *
 * This replaces an ALLOW_PROJECT_SWITCH flag that guarded the same accident.
 * The flag appeared twice in its own happy path, including on the production
 * build — and a safety flag the instructions tell you to always pass is not a
 * safety flag, it is a keystroke you type reflexively on the one day it was
 * trying to stop you. Naming the file after the project makes production's
 * snapshot unwritable by a dev build by construction, and needs no flag at all
 * in normal work.
 *
 * The one fact that cannot be derived: which ref is production. It lives in
 * data/production-ref, one line, committed, greppable. Changing which project
 * is production is editing that file, which is deliberate and self-documenting
 * in a diff — which is what the flag was pretending to be.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const POINTER = '.snapshot-current';

/** https://abcdefgh.supabase.co -> abcdefgh; a local stack -> 'local'. */
export function projectRef(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/^(127\.|localhost|\[?::1)/.test(host)) return 'local';
  return host.split('.')[0] || 'unknown';
}

export function productionRef(root = process.cwd()) {
  const f = path.join(root, 'data', 'production-ref');
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').replace(/#.*$/gm, '').trim() || null;
}

/** The file a build against `ref` should write. */
export function snapshotFileFor(ref, root = process.cwd()) {
  const prod = productionRef(root);
  return !ref || ref === prod ? 'snapshot.json' : `snapshot.${ref}.json`;
}

/**
 * The file a build should READ. The pointer is written by fetch-content and is
 * gitignored, so a fresh clone — and anything that has never fetched — falls
 * back to production's committed snapshot, which is the right default for
 * `--from-snapshot`.
 */
export function currentSnapshotPath(root = process.cwd()) {
  const dir = path.join(root, 'data');
  const pointer = path.join(dir, POINTER);
  if (existsSync(pointer)) {
    const named = path.join(dir, readFileSync(pointer, 'utf8').trim());
    if (existsSync(named)) return named;
  }
  return path.join(dir, 'snapshot.json');
}
