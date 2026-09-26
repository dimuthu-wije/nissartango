// Where an event's flyer goes in Storage, and whether a file may be one.
//
// Split out of event.js so Node can test it, like pkce.js, expiry.js,
// consent.js, signout.js and target.js: no DOM, no fetch, no File object --
// just the three fields a File happens to have.
//
// THE PATH IS COMPUTED, NEVER TYPED. `image_path` was a free-text box, which
// meant filling it in required knowing that the bucket's convention is
// <organizer_id>/<event_id>/<filename> and that the write policy checks the
// FIRST segment:
//
//     is_member(uuid_or_null((storage.foldername(name))[1]))
//
// So a typed path could be refused by RLS for a reason nothing on screen
// explained, and a correct one required two uuids nobody has memorised. The
// editor knows both, so it builds the path.
//
// THE LIMITS MIRROR THE BUCKET, and are not the enforcement. 20260828190200
// creates event-images with file_size_limit 5242880 and allowed_mime_types
// image/jpeg, image/png, image/webp, image/avif -- measured against the local
// stack 2026-09-26, not copied from memory. Storage refuses anything else
// whatever this file says; these exist so the refusal is explained before a
// 5 MB upload rather than after it.
//
// THE FILENAME IS FLATTENED HERE TOO. scripts/fetch-content.mjs downloads each
// object to src/assets/events/ under
//
//     storagePath.replace(/[^a-zA-Z0-9._-]+/g, '-')
//
// so two objects whose paths differ only in characters that flattening
// collapses would land on ONE local file and one would silently win. Keeping
// the uploaded name already flatten-safe means the stored path and the built
// filename correspond, and no two uploads can collide by accident.

export const MAX_BYTES = 5_242_880;          // storage.buckets.file_size_limit

export const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Flatten-safe, lowercase, extension preserved. Never empty, never a dot name.
 *
 * ACCENTS ARE FOLDED, not dropped. Stripping them turned "Affiche Été 2026.PNG"
 * into "affiche-t-2026.png" -- the É and the é vanished and took the word with
 * them. Decomposing first (NFD) separates each letter from its accent, so the
 * letter survives the filter and only the combining mark is removed. These are
 * French flyers; "été" is not an edge case.
 *
 * DOT NAMES ARE REFUSED. "..." produced "..", a filename that means the parent
 * directory. Nothing here joins it to anything unsafely -- the result is one
 * path segment and the slashes are added by storagePathFor -- but a name that
 * reads as traversal is not worth keeping when the alternative is "flyer".
 */
export function safeName(filename) {
  const raw = String(filename ?? '').trim().toLowerCase()
    // NFD splits "é" into "e" + U+0301; \p{M} is that combining mark.
    .normalize('NFD').replace(/\p{M}+/gu, '');

  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^a-z0-9]+/g, '') : '';
  const base = (dot > 0 ? raw.slice(0, dot) : raw)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')        // one dash, however many characters collapsed
    .replace(/^[.\-]+|[.\-]+$/g, '')   // no leading dot: no ".." and no hidden file
    .slice(0, 60)
    .replace(/[.\-]+$/g, '');     // the slice may have left a trailing dot

  const stem = base || 'flyer';
  return ext ? `${stem}.${ext}` : stem;
}

/**
 * <organizer_id>/<event_id>/<filename> — the convention the bucket's comment
 * states and the write policy half-enforces (it checks only the first segment).
 */
export function storagePathFor(organizerId, eventId, filename) {
  if (!organizerId) throw new Error('no organizer for this event');
  if (!eventId) throw new Error('an image needs an event that exists');
  return `${organizerId}/${eventId}/${safeName(filename)}`;
}

/**
 * @param {{name?: string, type?: string, size?: number}} file
 * @returns {string[]} reasons it cannot be uploaded; empty means it can
 */
export function checkImage(file) {
  const problems = [];
  if (!file) return ['Choisissez un fichier.'];

  if (!ALLOWED[file.type]) {
    problems.push(
      `Format non accepté${file.type ? ` (${file.type})` : ''} — `
      + 'JPEG, PNG, WebP ou AVIF uniquement.');
  }
  if (typeof file.size === 'number') {
    if (file.size === 0) {
      problems.push('Le fichier est vide.');
    } else if (file.size > MAX_BYTES) {
      // Rounded UP. toFixed(1) turned 5_242_881 bytes into "5.0 Mo", so the
      // message read "Trop volumineux (5.0 Mo) — 5 Mo maximum" and appeared to
      // refuse a file the size of the limit. Rounding up never understates,
      // which is the only direction that can mislead here.
      const mb = (Math.ceil((file.size / 1_048_576) * 10) / 10).toFixed(1);
      problems.push(`Trop volumineux (${mb} Mo) — 5 Mo maximum.`);
    }
  }
  return problems;
}
