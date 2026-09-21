// Form validation that MIRRORS the database, and is not the enforcement.
//
// Every rule here also exists as a CHECK constraint or a trigger on
// public.events, measured against production on 2026-09-21:
//
//   events_title_check                  btrim(title) <> ''
//   events_city_check                   btrim(city) <> ''
//   events_duration_minutes_check       1..10080
//   events_location_postal_code_check   ^[0-9]{5}$
//   events_signup_url_check             ^https?://
//   events_price_full_check             >= 0
//   events_price_member_check           >= 0
//   events_recurrence_end_needs_series  recurrence <> 'none' OR recurrence_end IS NULL
//   events_note_needs_cancellation      cancellation_note IS NULL OR cancelled_at IS NOT NULL
//   events_validate (trigger)           recurrence_end not before the first occurrence
//
// The point of duplicating them is that a person is told BEFORE a round trip,
// not that the server can relax. If the two ever disagree the database is
// right and this file is the bug — which is why the constraint names are
// written above, so the next person can diff the two lists rather than guess.
//
// No imports, so Node can test it. That is the whole reason it is not inside
// event.js.

/**
 * @param {object} v values read from the form
 * @returns {[string, string][]} [field, message] pairs; empty means sendable
 */
export function validate(v) {
  const p = [];
  if (!v.organizer_id) p.push(['organizer_id', 'Choose an organizer.']);
  if (!v.title) p.push(['title', 'A title is required — the database refuses a blank one.']);
  if (!v.city) p.push(['city', 'A city is required.']);
  if (!v.starts_at_local) p.push(['starts_at', 'A start date and time are required.']);

  if (v.duration_minutes != null) {
    if (!Number.isInteger(v.duration_minutes) || v.duration_minutes <= 0 || v.duration_minutes > 10080) {
      p.push(['duration_minutes', 'Between 1 and 10080 minutes (one week), or leave it blank.']);
    }
  }
  if (v.location_postal_code && !/^[0-9]{5}$/.test(v.location_postal_code)) {
    p.push(['location_postal_code', 'Exactly five digits, or leave it blank.']);
  }
  if (v.signup_url && !/^https?:\/\//.test(v.signup_url)) {
    p.push(['signup_url', 'Must start with http:// or https://.']);
  }
  for (const k of ['price_full', 'price_member']) {
    if (v[k] != null && (Number.isNaN(v[k]) || v[k] < 0)) {
      p.push([k, 'Zero or more, or leave it blank.']);
    }
  }
  if (v.recurrence === 'none' && v.recurrence_end) {
    p.push(['recurrence_end', 'Only a repeating event can have an end date.']);
  }
  // Compared as DATES in the event's own timezone, which is what the trigger
  // does: (starts_at at time zone timezone)::date. Comparing instants instead
  // would reject a valid same-day end for any event after 01:00 CET.
  if (v.recurrence !== 'none' && v.recurrence_end && v.starts_at_date &&
      v.recurrence_end < v.starts_at_date) {
    p.push(['recurrence_end', `Before the first occurrence (${v.starts_at_date}).`]);
  }
  if (v.cancellation_note && !v.cancelled_at_local) {
    p.push(['cancellation_note', 'Tick "This event is cancelled" above, or clear this.']);
  }
  return p;
}
