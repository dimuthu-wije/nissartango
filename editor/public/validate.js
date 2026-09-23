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

// ---------------------------------------------------------------------------
// Organizers.
//
// Same contract as above: every rule is a CHECK on public.organizers, read
// from 20260828181100_organizers.sql and 20260922120000_organizer_public_contact.sql
// rather than remembered.
//
//   organizers_name_check                     btrim(name) <> ''
//   organizers_website_check                  ^https?://
//   organizers_instagram_check                ^[A-Za-z0-9._]{1,40}$
//   organizers_facebook_check                 ^[A-Za-z0-9._-]{1,60}$
//   organizers_tiktok_check                   ^[A-Za-z0-9._]{1,40}$
//   organizers_email_check                    ^[^@\s]+@[^@\s]+\.[^@\s]+$
//   organizers_phone_check                    btrim(phone) <> ''
//   organizers_contact_email_check            same shape as email
//   organizers_contact_phone_check            btrim(contact_phone) <> ''
//   organizers_contact_email_needs_consent    contact_email IS NULL OR consent IS NOT NULL
//   organizers_contact_phone_needs_consent    contact_phone IS NULL OR consent IS NOT NULL
//
// `slug` is absent on purpose and is not a rule this file enforces: it is not
// in the UPDATE grant at all, so the form cannot offer it. A slug is a URL.

// Postgres's regex uses [:space:]; JS \s is close enough for a pre-flight and
// the database is the authority either way.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const HANDLE = {
  instagram: [/^[A-Za-z0-9._]{1,40}$/, 'Letters, numbers, dots and underscores, up to 40.'],
  facebook: [/^[A-Za-z0-9._-]{1,60}$/, 'Letters, numbers, dots, underscores and hyphens, up to 60.'],
  tiktok: [/^[A-Za-z0-9._]{1,40}$/, 'Letters, numbers, dots and underscores, up to 40.'],
};

/**
 * @param {object} v values read from the organizer form
 * @returns {[string, string][]} [field, message] pairs; empty means sendable
 */
export function validateOrganizer(v) {
  const p = [];
  if (!v.name) p.push(['name', 'A name is required — the database refuses a blank one.']);

  if (v.website && !/^https?:\/\//.test(v.website)) {
    p.push(['website', 'Must start with http:// or https://.']);
  }

  // The handles are stored as HANDLES, never URLs, so that the template can
  // build the link. Pasting a profile URL is the mistake this catches, and it
  // is worth catching here because the constraint's message would not explain
  // why https://instagram.com/x is refused.
  for (const [k, [re, message]] of Object.entries(HANDLE)) {
    if (!v[k]) continue;
    if (/^https?:\/\/|\//.test(v[k])) {
      p.push([k, 'A handle, not a link — "nissartango", not "https://instagram.com/nissartango".']);
    } else if (!re.test(v[k])) {
      p.push([k, message]);
    }
  }

  if (v.email && !EMAIL.test(v.email)) p.push(['email', 'Does not look like an address.']);
  if (v.contact_email && !EMAIL.test(v.contact_email)) {
    p.push(['contact_email', 'Does not look like an address.']);
  }

  // The consent half. The database refuses a published value without one, so
  // this exists to say WHY before the round trip rather than to permit
  // anything. Both directions are reported: a ticked box with nothing to
  // publish is not a database error, but it is certainly a mistake on screen.
  for (const kind of ['email', 'phone']) {
    const value = v[`contact_${kind}`];
    const consent = v[`contact_${kind}_consented`];
    if (value && !consent) {
      p.push([`contact_${kind}`,
        'Tick the box below to confirm this may be published, or clear the field.']);
    }
    if (!value && consent && !v[`contact_${kind}_was_consented`]) {
      p.push([`contact_${kind}`, 'Nothing to publish — fill this in, or untick the box.']);
    }
  }
  return p;
}
