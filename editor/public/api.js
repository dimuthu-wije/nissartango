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
// Note HOW `authenticated` may write `events`: INSERT and UPDATE are granted
// on 21 COLUMNS, not on the table. `status`, `review_note`, `needs_review`,
// `slug` and `created_by` are outside that list, so a status change cannot be
// expressed as a table write at all and has to go through
// approve_event/reject_event, which check is_admin() themselves. The UI cannot
// bypass moderation because there is no request it could send that would.
//
// (An earlier version of this comment said there was no UPDATE grant. That was
// a query against information_schema.role_table_grants, which shows only
// table-level grants and returns nothing for column ones.)

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';
import { getSession, refreshSession, AuthExpired } from '/auth.js';

// Re-exported so callers have one import for "the session is gone".
export { AuthExpired };

const REST = `${SUPABASE_URL}/rest/v1`;

function headers(session, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    ...extra,
  };
}

async function handle(res) {
  let body = null;
  try { body = await res.json(); } catch { /* 204 */ }
  if (!res.ok) {
    // 403 and the rest land here. 401 never does -- send() deals with it --
    // and that separation is the point: the session expiring and RLS refusing
    // are different problems with different fixes, and sending someone to the
    // sign-in page for a permission error teaches them nothing.
    throw new Error(body?.message || body?.hint || body?.details || `HTTP ${res.status}`);
  }
  return body;
}

/**
 * Send a request with a valid session, and retry once if the server disagrees.
 *
 * getSession() refreshes proactively when the clock says the token is nearly
 * out, which handles the ordinary case. A 401 AFTER that means the token was
 * rejected for a reason the clock could not predict -- revoked elsewhere,
 * signing key rotated, a clock skew wider than the sixty-second margin. One
 * refresh and one retry covers all of those.
 *
 * Exactly one retry, deliberately. If a freshly refreshed token is also
 * refused, retrying again would loop against a server that has made its
 * position clear.
 *
 * `build` is a function rather than a prepared Request because the retry needs
 * to rebuild the headers with the NEW token -- reusing the first attempt's
 * would resend the one that was just rejected, which is the quiet way this
 * pattern fails.
 */
async function send(build) {
  let res = await build(await getSession());
  if (res.status === 401) {
    res = await build(await refreshSession());   // throws AuthExpired if it cannot
    if (res.status === 401) {
      throw new AuthExpired('the server rejected a freshly refreshed token');
    }
  }
  return handle(res);
}

export const select = (path) =>
  send((s) => fetch(`${REST}/${path}`, { headers: headers(s) }));

export const rpc = (fn, args) =>
  send((s) => fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: headers(s, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(args ?? {}),
  }));

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
