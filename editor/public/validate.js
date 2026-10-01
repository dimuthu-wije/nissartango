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
  if (!v.organizer_id) p.push(['organizer_id', 'Choisissez un organisateur.']);
  if (!v.title) p.push(['title', 'Un titre est obligatoire : la base refuse un titre vide.']);
  // The old control was a select that defaulted to Milonga, so this could not
  // be empty and nothing checked it. Checkboxes can be, and must be refused
  // rather than guessed -- an event published as a milonga because nobody
  // ticked anything is worse than a form that will not submit.
  if (!v.formats?.length) {
    p.push(['formats', 'Choisissez au moins un type — un cours, une soirée, ou les deux.']);
  }
  if (!v.city) p.push(['city', 'La ville est obligatoire.']);
  if (!v.starts_at_local) p.push(['starts_at', 'La date et l\'heure de début sont obligatoires.']);

  if (v.duration_minutes != null) {
    if (!Number.isInteger(v.duration_minutes) || v.duration_minutes <= 0 || v.duration_minutes > 10080) {
      p.push(['duration_minutes', 'Entre 1 et 10080 minutes (une semaine), ou laissez vide.']);
    }
  }
  if (v.location_postal_code && !/^[0-9]{5}$/.test(v.location_postal_code)) {
    p.push(['location_postal_code', 'Exactement cinq chiffres, ou laissez vide.']);
  }
  if (v.signup_url && !/^https?:\/\//.test(v.signup_url)) {
    p.push(['signup_url', 'Doit commencer par http:// ou https://.']);
  }
  for (const k of ['price_full', 'price_member']) {
    if (v[k] != null && (Number.isNaN(v[k]) || v[k] < 0)) {
      p.push([k, 'Zéro ou plus, ou laissez vide.']);
    }
  }
  if (v.recurrence === 'none' && v.recurrence_end) {
    p.push(['recurrence_end', 'Seul un événement récurrent peut avoir une date de fin.']);
  }
  // Compared as DATES in the event's own timezone, which is what the trigger
  // does: (starts_at at time zone timezone)::date. Comparing instants instead
  // would reject a valid same-day end for any event after 01:00 CET.
  if (v.recurrence !== 'none' && v.recurrence_end && v.starts_at_date &&
      v.recurrence_end < v.starts_at_date) {
    p.push(['recurrence_end', `Antérieure à la première occurrence (${v.starts_at_date}).`]);
  }
  if (v.cancellation_note && !v.cancelled_at_local) {
    p.push(['cancellation_note', 'Cochez « Cet événement est annulé » ci-dessus, ou videz ce champ.']);
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

// One entry per platform, because one message for three fields is what was
// here until 2026-10-01: pasting a Facebook URL into the Facebook field
// answered « pas « https://instagram.com/nissartango » », naming the wrong site
// and giving no help with the one in front of you. `url` is the prefix
// socialLinks() in src/lib/content.ts builds, so a message quoting it shows the
// address that will actually be produced -- including TikTok's @, which is in
// the prefix and must NOT be in the stored handle.
const HANDLE = {
  instagram: {
    re: /^[A-Za-z0-9._]{1,40}$/,
    url: 'https://instagram.com/',
    chars: 'Lettres, chiffres, points et tirets bas, 40 caractères maximum.',
  },
  facebook: {
    re: /^[A-Za-z0-9._-]{1,60}$/,
    url: 'https://facebook.com/',
    chars: 'Lettres, chiffres, points, tirets bas et traits d\'union, 60 caractères maximum.',
    // A Page with no username has no handle to extract -- its address is
    // numeric. Telling someone to "enter the identifier" when there isn't one
    // is the kind of advice that makes people retype the URL twice.
    noHandle: /profile\.php|\/pages\//i,
    noHandleHelp: 'Cette page n\'a pas encore de nom d\'utilisateur : son adresse '
      + 'contient « profile.php?id=… ». Créez-en un (Paramètres de la Page → '
      + 'Nom d\'utilisateur), ou laissez ce champ vide.',
  },
  tiktok: {
    re: /^[A-Za-z0-9._]{1,40}$/,
    url: 'https://tiktok.com/@',
    chars: 'Lettres, chiffres, points et tirets bas, 40 caractères maximum.',
  },
};

/**
 * The handle inside a pasted profile link: last path segment, without a query,
 * a fragment or a leading @. '' when there is nothing to take.
 */
function handleInLink(value) {
  const path = String(value).replace(/^https?:\/\/[^/]*/i, '').split(/[?#]/)[0];
  return (path.split('/').filter(Boolean).pop() ?? '').replace(/^@/, '');
}

/**
 * @param {object} v values read from the organizer form
 * @returns {[string, string][]} [field, message] pairs; empty means sendable
 */
export function validateOrganizer(v) {
  const p = [];
  if (!v.name) p.push(['name', 'Le nom est obligatoire : la base refuse un nom vide.']);

  if (v.website && !/^https?:\/\//.test(v.website)) {
    p.push(['website', 'Doit commencer par http:// ou https://.']);
  }

  // The handles are stored as HANDLES, never URLs, so that the template can
  // build the link. Pasting a profile URL is the mistake the field invites, and
  // it is worth catching here because the constraint's message would not
  // explain why https://instagram.com/x is refused.
  //
  // Each message names the platform in front of you and, where the link
  // contains a usable handle, QUOTES IT -- "in this link it is « bicilonga »"
  // beats "enter an identifier", which leaves the reader to work out which part
  // of their own URL was meant.
  for (const [k, rule] of Object.entries(HANDLE)) {
    const value = v[k];
    if (!value) continue;

    if (/^https?:\/\/|\//.test(value)) {
      if (rule.noHandle?.test(value)) {
        p.push([k, rule.noHandleHelp]);
        continue;
      }
      const found = handleInLink(value);
      p.push([k, rule.re.test(found)
        ? `Un identifiant, pas un lien. Dans ce lien, c'est « ${found} » : `
          + 'saisissez seulement cela.'
        : 'Un identifiant, pas un lien. Le site construit l\'adresse : '
          + `« ${rule.url}votre-identifiant ».`]);
      continue;
    }

    // A leading @ is how these are written everywhere except in the field that
    // stores them, and for TikTok the @ is part of the address the site builds.
    const bare = value.replace(/^@/, '');
    if (bare !== value && rule.re.test(bare)) {
      p.push([k, `Sans le « @ » : « ${bare} ». Le site construit « ${rule.url}${bare} ».`]);
      continue;
    }

    if (!rule.re.test(value)) p.push([k, rule.chars]);
  }

  if (v.email && !EMAIL.test(v.email)) p.push(['email', 'Ne ressemble pas à une adresse e-mail.']);
  if (v.contact_email && !EMAIL.test(v.contact_email)) {
    p.push(['contact_email', 'Ne ressemble pas à une adresse e-mail.']);
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
        'Cochez la case ci-dessous pour confirmer la publication, ou videz le champ.']);
    }
    if (!value && consent && !v[`contact_${kind}_was_consented`]) {
      p.push([`contact_${kind}`, 'Rien à publier : remplissez ce champ, ou décochez la case.']);
    }
  }
  return p;
}
