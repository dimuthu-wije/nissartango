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

// ---------------------------------------------------------------------------
// Events: read one, create, update.
//
// WRITABLE is the 21 columns `authenticated` holds column-level INSERT and
// UPDATE on, measured against production rather than copied from the migration.
// Sending anything outside it is refused by the database, not by this list --
// the list exists so the refusal never has to happen.
//
// Conspicuously absent, and not oversights: `status` (approve_event /
// reject_event only), `review_note` (the admin's channel), `needs_review` (set
// by trigger), `slug` (derived once, permalinks are forever), `created_by`
// (filled from auth.uid() by DEFAULT) and `legacy_slugs`.
// ---------------------------------------------------------------------------

export const WRITABLE = [
  'organizer_id', 'title', 'type', 'starts_at', 'duration_minutes', 'timezone',
  'recurrence', 'recurrence_end',
  'location_name', 'location_address', 'location_postal_code', 'city',
  'teachers', 'price_full', 'price_member', 'price_note',
  'signup_url', 'image_path', 'body',
  'cancelled_at', 'cancellation_note',
];

async function write(method, path, body) {
  return send((s) => fetch(`${REST}/${path}`, {
    method,
    headers: headers(s, {
      'Content-Type': 'application/json',
      // Ask for the row back. Without it a successful write returns 204 and
      // the page has to guess what the database actually stored -- which
      // matters here, because triggers derive the slug and defaults fill in
      // columns the form never sent.
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(body),
  }));
}

/**
 * The organizers this caller may create events FOR.
 *
 * Read from organizer_members, not from organizers. An admin can SELECT every
 * organizer but may only INSERT for ones they are a member of -- so listing
 * `organizers` would offer choices that fail on save with a 403 the person
 * cannot act on. This list is correct by construction.
 */
export const myOrganizers = () =>
  select('organizer_members?select=role,organizers(id,name,slug)');

export const getEvent = (id) =>
  select(`events?select=id,slug,status,needs_review,review_note,${WRITABLE.join(',')}` +
         `&id=eq.${encodeURIComponent(id)}`).then((rows) => rows?.[0] ?? null);

export const createEvent = (fields) =>
  write('POST', 'events', fields).then((rows) => rows?.[0] ?? null);

export const updateEvent = (id, fields) =>
  write('PATCH', `events?id=eq.${encodeURIComponent(id)}`, fields)
    .then((rows) => rows?.[0] ?? null);

// ---------------------------------------------------------------------------
// Exceptions: one DATE of a repeating event, off or moved.
//
// A different thing from events.cancelled_at, and the two are worth keeping
// straight because the form used to offer only the wrong one:
//
//   events.cancelled_at   the WHOLE event is off, forever. The page stays and
//                         says Annulé. src/pages/evenements/[slug].astro only
//                         ever asks Boolean(cancelled_at) -- the timestamp is
//                         a flag, never a date anyone reads.
//   event_exceptions      ONE occurrence, by DATE, with no time. Cancelled
//                         ones are still rendered, flagged, because "pas de
//                         practica le 15 août" tells a reader more than a week
//                         that silently is not there.
//
// `moved` relocates an occurrence to moved_starts_at and keeps the original as
// previousStart for schema.org. Both kinds are handled by src/lib/occurrences.js.
// ---------------------------------------------------------------------------

async function del(path) {
  // No body: DELETE with one is accepted by some servers and rejected by
  // others, and PostgREST takes its filter from the query string regardless.
  return send((s) => fetch(`${REST}/${path}`, {
    method: 'DELETE',
    headers: headers(s, { Prefer: 'return=representation' }),
  }));
}

export const listExceptions = (eventId) =>
  select('event_exceptions?select=occurrence_date,kind,note,moved_starts_at' +
         `&event_id=eq.${encodeURIComponent(eventId)}&order=occurrence_date.asc`);

export const addException = (row) => write('POST', 'event_exceptions', row);

/**
 * Keyed by (event_id, occurrence_date) -- the pair content.config.ts also uses
 * as the collection id, so it is the identity of an exception everywhere.
 */
export const removeException = (eventId, occurrenceDate) =>
  del(`event_exceptions?event_id=eq.${encodeURIComponent(eventId)}` +
      `&occurrence_date=eq.${encodeURIComponent(occurrenceDate)}`);
