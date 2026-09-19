// PostgREST, with the caller's own JWT.
//
// Every request carries two things: the publishable key, which identifies the
// project, and the access token, which identifies the PERSON. The first grants
// nothing. The second is what RLS evaluates, in the database, on every row of
// every request -- so what comes back is not filtered by this file and could
// not be widened by editing it. That is the property the whole schema was
// built around, and it is why an editor can be a static page with no server of
// its own.
//
// Note what `authenticated` actually holds on `events`: SELECT and DELETE, and
// NO UPDATE (measured 2026-09-19). A status change is therefore impossible to
// express as a table write and has to go through approve_event/reject_event,
// which check is_admin() themselves. The UI cannot bypass moderation because
// there is no request it could send that would.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';
import { storedSession } from '/auth.js';

const REST = `${SUPABASE_URL}/rest/v1`;

export class AuthExpired extends Error {
  constructor() { super('your session has expired'); this.name = 'AuthExpired'; }
}

function headers(session, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    ...extra,
  };
}

async function handle(res) {
  // 401 is the session; 403 is RLS. Collapsing them would send someone to the
  // sign-in page for a permission problem, where signing in again changes
  // nothing and tells them nothing.
  if (res.status === 401) throw new AuthExpired();
  let body = null;
  try { body = await res.json(); } catch { /* 204 */ }
  if (!res.ok) {
    throw new Error(body?.message || body?.hint || body?.details || `HTTP ${res.status}`);
  }
  return body;
}

function session() {
  const s = storedSession();
  if (!s) throw new AuthExpired();
  return s;
}

export async function select(path) {
  const res = await fetch(`${REST}/${path}`, { headers: headers(session()) });
  return handle(res);
}

export async function rpc(fn, args) {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: headers(session(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args ?? {}),
  });
  return handle(res);
}

/** Does the database think this caller is an admin? Asked, never assumed. */
export const isAdmin = () => rpc('is_admin');

/**
 * The queue: anything awaiting a decision, or flagged for a second look.
 *
 * Deliberately NOT filtered to status=pending alone. `needs_review` is a
 * separate axis -- an already-approved event can be flagged -- and a queue that
 * only showed pending rows would hide exactly the items someone asked to be
 * looked at again.
 *
 * The organizer name is embedded rather than joined here, so a row that RLS
 * hides arrives as null and renders as "(not visible)" rather than throwing.
 */
export const reviewQueue = () =>
  select(
    'events?select=id,slug,title,type,starts_at,city,location_name,status,' +
    'needs_review,review_note,created_at,organizers(name,slug)' +
    '&or=(status.eq.pending,needs_review.is.true)' +
    '&order=created_at.asc',
  );

/** Recently decided, so a mistake is visible and reversible rather than gone. */
export const recentlyDecided = () =>
  select(
    'events?select=id,slug,title,status,review_note,updated_at' +
    '&status=in.(approved,rejected)&order=updated_at.desc&limit=5',
  );

export const approve = (id, note) => rpc('approve_event', { p_event: id, p_note: note || null });

/**
 * reject_event takes no default for its note, and the function itself refuses
 * a blank one. Checking here too is not redundant: it is the difference
 * between a disabled button and a round trip that fails.
 */
export const reject = (id, note) => {
  if (!note || !note.trim()) throw new Error('a rejection needs a reason');
  return rpc('reject_event', { p_event: id, p_note: note.trim() });
};

export const markReviewed = (id) => rpc('mark_reviewed', { p_event: id });
