// Create and edit an event.
//
// `/event/` creates, `/event/?id=<uuid>` edits. One form for both, because the
// writable column set is identical — 21 columns, granted at column level, so
// `status`, `slug`, `review_note` and `needs_review` are not expressible here
// no matter what this file does.
//
// WHAT THIS FORM CANNOT DO, and should not pretend to: publish. The insert
// policy is
//
//     is_member(organizer_id) AND status = 'pending' AND created_by = auth.uid()
//
// so every event created here arrives PENDING, the maintainer's own included.
// The queue is what publishes. That is why there is no "publish" control and
// no status field — not because they were left out, but because the database
// would refuse them.
//
// VALIDATION LIVES IN validate.js, with the constraint names it mirrors
// written beside each rule. It is not the enforcement and must never be
// mistaken for it — it exists so a person is told before a round trip. If it
// and the database ever disagree, the database is right.

import { getSession, hasSession, claimsOf } from '/auth.js';
import {
  myOrganizers, getEvent, createEvent, updateEvent,
  listExceptions, addException, removeException, uploadEventImage, AuthExpired,
} from '/api.js';
import { ALLOWED, checkImage, storagePathFor } from '/image.js';
import { zonedToInstant, partsInZone } from '/zone.js';
import { validate } from '/validate.js';
import '/banner.js';
import '/signout-button.js';   // side effect: names the project when it is not production

// {value, label}: the VALUE is the database enum and is never translated --
// events_type_check and events_recurrence_check compare against these exact
// strings. Only the word on screen is French. The recurrence wording matches
// RECURRENCE_LABELS in src/lib/occurrences.js, so the editor and the site say
// the same thing about the same event; 'none' has no label there because the
// site never prints one for a single date.
const TYPES = [
  { value: 'cours', label: 'Cours' },
  { value: 'practica', label: 'Practica' },
  { value: 'milonga', label: 'Milonga' },
  { value: 'stage', label: 'Stage' },
  { value: 'demo', label: 'Démonstration' },
  { value: 'festival', label: 'Festival' },
];
const RECURRENCES = [
  { value: 'none', label: 'Une seule date' },
  { value: 'weekly', label: 'Chaque semaine' },
  { value: 'biweekly', label: 'Toutes les deux semaines' },
  { value: 'monthly', label: 'Chaque mois' },
];

// A short list, not every zone the database accepts. `events_validate` checks
// against pg_timezone_names, so anything here is valid; the point of a short
// list is that a typo is impossible rather than caught. Buenos Aires because
// this is a tango site and a stage abroad is plausible.
const TIMEZONES = [
  'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Berlin', 'Europe/Lisbon', 'America/Argentina/Buenos_Aires', 'UTC',
];

// Exception kinds, shown in French. The VALUE goes to the database --
// event_exceptions.kind is an enum of exactly these two -- so only the label
// changes, and the row's tag class still keys off the raw value.
const EXCEPTION_KINDS = { cancelled: 'annulée', moved: 'déplacée' };

// Same map as queue.js. The VALUE is the database enum; only the word changes.
const STATUS_LABELS = {
  pending: 'en attente', approved: 'approuvé', rejected: 'rejeté',
};

const out = () => document.querySelector('#out');
const pad = (n) => String(n).padStart(2, '0');

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

const box = (cls, title, detail) => {
  const b = el('div', null, `box ${cls}`);
  if (title) b.appendChild(el('h2', title));
  if (detail) b.appendChild(el('p', detail));
  return b;
};

// --- wall clock <-> instant -------------------------------------------------
//
// `<input type="datetime-local">` speaks naive wall-clock time with no zone.
// The database stores an absolute instant. Converting between them is the one
// genuinely easy thing to get wrong here, which is why zone.js is a verbatim
// copy of the tested original rather than something written again.

/** "2027-01-15T20:00" in `tz`  ->  ISO instant for the database. */
function inputToInstant(value, tz) {
  if (!value) return null;
  const [d, t = '00:00'] = value.split('T');
  const [year, month, day] = d.split('-').map(Number);
  const [hour, minute] = t.split(':').map(Number);
  return zonedToInstant({ year, month, day, hour, minute }, tz).toISOString();
}

/** An instant from the database  ->  "2027-01-15T20:00" as read in `tz`. */
function instantToInput(iso, tz) {
  if (!iso) return '';
  const p = partsInZone(new Date(iso), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The calendar date of an instant in `tz` — what recurrence_end compares to. */
function instantToDate(iso, tz) {
  if (!iso) return '';
  const p = partsInZone(new Date(iso), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// --- field construction -----------------------------------------------------

const fields = new Map();

function field(name, labelText, control, { hint, required } = {}) {
  const wrap = el('div', null, 'field');
  const label = el('label', labelText + (required ? ' *' : ''));
  label.setAttribute('for', name);
  control.id = name;
  control.name = name;
  wrap.append(label, control);
  if (hint) wrap.appendChild(el('p', hint, 'hint'));
  const err = el('p', null, 'field-error');
  err.hidden = true;
  wrap.appendChild(err);
  fields.set(name, { control, err, wrap });
  return wrap;
}

const input = (type, attrs = {}) => Object.assign(el('input'), { type, ...attrs });

function selectOf(options, value) {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', o.label ?? o);
    opt.value = o.value ?? o;
    if ((o.value ?? o) === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

const val = (n) => fields.get(n).control.value.trim();
const num = (n) => (val(n) === '' ? null : Number(val(n)));

function showErrors(problems) {
  for (const { err, wrap } of fields.values()) {
    err.hidden = true; err.textContent = ''; wrap.classList.remove('has-error');
  }
  for (const [name, message] of problems) {
    const f = fields.get(name);
    if (!f) continue;
    f.err.textContent = message;
    f.err.hidden = false;
    f.wrap.classList.add('has-error');
  }
  if (problems.length) fields.get(problems[0][0])?.control.focus();
}

function readForm() {
  const tz = val('timezone');
  const startsLocal = fields.get('starts_at').control.value;
  const startsIso = inputToInstant(startsLocal, tz);
  // The checkbox carries no time of its own. Keep the original stamp when it
  // was already cancelled, so re-saving an edit does not rewrite when the
  // cancellation happened.
  const wasCancelled = fields.get('cancelled_at').wasCancelledAt ?? null;
  const cancelledNow = fields.get('cancelled_at').control.checked;
  const cancelledIso = cancelledNow ? (wasCancelled ?? new Date().toISOString()) : null;
  return {
    organizer_id: val('organizer_id'),
    title: val('title'),
    type: val('type'),
    timezone: tz,
    starts_at_local: startsLocal,
    starts_at_date: startsIso ? instantToDate(startsIso, tz) : '',
    starts_at: startsIso,
    duration_minutes: num('duration_minutes'),
    recurrence: val('recurrence'),
    recurrence_end: val('recurrence_end') || null,
    location_name: val('location_name') || null,
    location_address: val('location_address') || null,
    location_postal_code: val('location_postal_code') || null,
    city: val('city'),
    // Split on commas, drop blanks. `teachers` is NOT NULL with a '{}' default,
    // so an empty field must send [] and never null.
    teachers: val('teachers').split(',').map((s) => s.trim()).filter(Boolean),
    price_full: num('price_full'),
    price_member: num('price_member'),
    price_note: val('price_note') || null,
    signup_url: val('signup_url') || null,
    image_path: val('image_path') || null,
    body: fields.get('body').control.value.trim() || null,
    // validate.js checks cancellation_note against this, so it has to be
    // truthy-when-cancelled in the same way the old datetime field was.
    cancelled_at_local: cancelledNow ? 'yes' : '',
    cancelled_at: cancelledIso,
    cancellation_note: val('cancellation_note') || null,
  };
}

/** Only the columns the database will accept. */
function payload(v) {
  const { starts_at_local, starts_at_date, cancelled_at_local, ...rest } = v;
  return rest;
}

// --- the page ---------------------------------------------------------------

function buildForm(organizers, existing) {
  const tz = existing?.timezone ?? 'Europe/Paris';
  const form = el('form', null, 'event-form');
  fields.clear();

  // NATIVE VALIDATION OFF, deliberately, and validate.js is the authority.
  //
  // It mirrors the CHECK constraints on public.events with the constraint
  // names written beside each rule, and reports in French next to the field.
  // The browser's constraint validation duplicates a subset of that, reports
  // in a bubble this page does not control, in the browser's locale rather
  // than the site's — and blocks the submit event before our handler runs, so
  // a value it dislikes produces no message of ours at all.
  //
  // Concretely: step="1" on the price fields makes 12,50 step-mismatched.
  // Without this, entering a price with centimes would make the save button do
  // nothing visible.
  form.noValidate = true;

  // Same shape as organizer.js's: a heading, and an optional line under it for
  // a section whose rule is not obvious from the field labels.
  const section = (title, note) => {
    form.appendChild(el('h3', title, 'section'));
    if (note) form.appendChild(el('p', note, 'hint'));
  };

  section('Quoi et qui');
  form.appendChild(field('organizer_id', 'Organisateur',
    selectOf(organizers.map((o) => ({ value: o.id, label: o.name })), existing?.organizer_id),
    { required: true, hint: organizers.length === 1
      ? 'Le seul organisateur pour lequel vous pouvez créer des événements.'
      : 'Seuls les organisateurs dont vous êtes membre sont listés : la base refuse les autres.' }));
  form.appendChild(field('title', 'Titre',
    input('text', { value: existing?.title ?? '', maxLength: 200 }), { required: true }));
  form.appendChild(field('type', 'Type', selectOf(TYPES, existing?.type ?? 'milonga'),
    { required: true }));
  // Teachers are part of "who", and moving prices out of "Détails" had left
  // that section holding this one field under a heading that said nothing.
  form.appendChild(field('teachers', 'Professeurs',
    input('text', { value: (existing?.teachers ?? []).join(', ') }),
    { hint: 'Séparés par des virgules.' }));

  section('Quand');
  form.appendChild(field('starts_at', 'Début',
    input('datetime-local', { value: instantToInput(existing?.starts_at, tz) }),
    { required: true, hint: 'Heure locale, dans le fuseau horaire ci-dessous.' }));
  form.appendChild(field('timezone', 'Fuseau horaire',
    selectOf(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES], tz),
    { required: true }));
  form.appendChild(field('duration_minutes', 'Durée (minutes)',
    input('number', { value: existing?.duration_minutes ?? '', min: 1, max: 10080, step: 1 }),
    { hint: 'Facultatif. Une série a une seule forme et plusieurs occurrences : il n\'y a donc pas d\'heure de fin.' }));
  form.appendChild(field('recurrence', 'Récurrence',
    selectOf(RECURRENCES, existing?.recurrence ?? 'none')));
  form.appendChild(field('recurrence_end', 'Jusqu\'au',
    input('date', { value: existing?.recurrence_end ?? '' }),
    { hint: 'Uniquement pour un événement récurrent, et pas avant la première occurrence.' }));

  section('Où');
  form.appendChild(field('location_name', 'Lieu',
    input('text', { value: existing?.location_name ?? '' })));
  form.appendChild(field('location_address', 'Adresse',
    input('text', { value: existing?.location_address ?? '' })));
  form.appendChild(field('location_postal_code', 'Code postal',
    input('text', { value: existing?.location_postal_code ?? '', inputMode: 'numeric', maxLength: 5 }),
    { hint: 'Cinq chiffres.' }));
  form.appendChild(field('city', 'Ville',
    input('text', { value: existing?.city ?? 'Nice' }), { required: true }));

  // Prices get their own section rather than sitting among teachers, links and
  // the flyer: three fields that answer one question, and the one a reader
  // looks for second after the date.
  //
  // step: '1', so the arrows move by a whole euro. They moved by a CENTIME,
  // which is a silly way to get from 10 € to 12 €.
  //
  // 'any' was tried first and is worse: measured in a browser, the arrows then
  // do NOTHING at all, and stepUp() throws "this form element does not have an
  // allowed value step". Stepping by one requires step="1".
  //
  // Which makes 12.50 fail the browser's OWN validity check, and native
  // validation runs before our submit handler — so the form would silently
  // refuse to submit with no message we control. Hence form.noValidate below.
  section('Tarif',
    'Les trois champs sont facultatifs et tous les trois sont publiés. '
    + 'Un chiffre seul, une note seule, ou les deux ensemble.');
  form.appendChild(field('price_full', 'Tarif',
    input('number', { value: existing?.price_full ?? '', min: 0, step: '1' }),
    { hint: '0 est un tarif : cela affiche « 0 € », pas « gratuit » par accident.' }));
  form.appendChild(field('price_member', 'Tarif adhérent',
    input('number', { value: existing?.price_member ?? '', min: 0, step: '1' })));
  form.appendChild(field('price_note', 'Note sur le tarif',
    input('text', { value: existing?.price_note ?? '' }),
    { hint: 'Pour ce qu\'un chiffre ne dit pas — « au chapeau », '
      + '« gratuit pour les étudiants ». Affichée À CÔTÉ des chiffres, plus à leur place.' }));

  section('Détails pratiques');
  form.appendChild(field('signup_url', 'Lien d\'inscription',
    input('url', { value: existing?.signup_url ?? '' }), { hint: 'http:// ou https://' }));
  form.appendChild(imageField(existing));
  const body = el('textarea');
  body.rows = 5;
  body.value = existing?.body ?? '';
  form.appendChild(field('body', 'Description', body));

  section('Annuler tout l\'événement');
  // A CHECKBOX, not a date. cancelled_at is lifecycle state stored as a
  // timestamp: the site only ever asks Boolean(cancelled_at), so the hour is
  // never read by anything. Offering a datetime picker invited a precision
  // that does not exist and made people wonder what time to put. Ticking
  // stamps now(); unticking nulls it, which is exactly how the schema
  // describes un-cancelling.
  //
  // To cancel ONE DATE of a repeating event, use Exceptions below instead.
  const cancelBox = input('checkbox');
  cancelBox.checked = Boolean(existing?.cancelled_at);
  const cancelWrap = field('cancelled_at', 'Cet événement est annulé', cancelBox, {
    hint: existing?.cancelled_at
      ? `Annulé le ${instantToInput(existing.cancelled_at, tz).replace('T', ' ')}. ` +
        'Décochez pour rétablir. La page reste dans les deux cas et affiche Annulé.'
      : 'L\'événement entier, toutes ses dates. Il garde sa page et affiche Annulé. ' +
        'Pour une seule date d\'un événement récurrent, utilisez les Exceptions ci-dessous.',
  });
  cancelWrap.classList.add('field-check');
  fields.get('cancelled_at').wasCancelledAt = existing?.cancelled_at ?? null;
  form.appendChild(cancelWrap);
  form.appendChild(field('cancellation_note', 'Motif',
    input('text', { value: existing?.cancellation_note ?? '' }),
    { hint: 'Affiché aux lecteurs. Nécessite la case ci-dessus cochée.' }));

  // Recurrence end only makes sense for a series. Disabled rather than hidden,
  // so the rule is visible instead of the control mysteriously not existing.
  const rec = fields.get('recurrence').control;
  const recEnd = fields.get('recurrence_end').control;
  const syncRecurrence = () => {
    recEnd.disabled = rec.value === 'none';
    if (recEnd.disabled) recEnd.value = '';
  };
  rec.addEventListener('change', syncRecurrence);
  syncRecurrence();

  return form;
}

async function save(existing, statusEl, submitEl) {
  const v = readForm();
  const problems = validate(v);
  showErrors(problems);
  if (problems.length) {
    statusEl.textContent = `${problems.length} point${problems.length > 1 ? 's' : ''} à corriger.`;
    return;
  }

  submitEl.disabled = true;
  statusEl.textContent = existing ? 'Saving…' : 'Creating…';
  try {
    const row = existing
      ? await updateEvent(existing.id, payload(v))
      : await createEvent(payload(v));
    renderSaved(row, !existing);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    submitEl.disabled = false;
    // The database's own words. A CHECK constraint or a trigger naming the
    // rule is more useful than anything this page could paraphrase.
    statusEl.textContent = `Refusé : ${err.message}`;
  }
}

function renderSaved(row, created) {
  const b = box('good', created ? 'Created.' : 'Saved.');
  const dl = el('dl');
  const add = (k, v2) => { dl.append(el('dt', k), el('dd', String(v2 ?? '—'))); };
  add('title', row?.title);
  add('slug', row?.slug);
  add('statut', STATUS_LABELS[row?.status] ?? row?.status);
  add('à revoir', row?.needs_review ? 'oui' : 'non');
  b.appendChild(dl);

  b.appendChild(el('p',
    created
      ? 'Créé EN ATTENTE — la politique d\'insertion n\'autorise rien d\'autre, pour personne. ' +
        'Il n\'est pas sur le site tant qu\'il n\'est pas approuvé dans la file d\'attente.'
      : row?.status === 'approved' && row?.needs_review
        ? 'Toujours publié, et signalé à revoir : modifier un événement en ligne ne le ' +
          'retire pas du site, cela le place dans la file d\'attente.'
        : 'Enregistré.',
    'note'));

  const queue = el('a', 'Ouvrir la file d\'attente');
  queue.href = '/queue/';
  queue.className = 'btn';
  const again = el('a', 'En ajouter un autre');
  again.href = '/event/';
  again.className = 'btn btn-quiet';
  const row2 = el('div', null, 'actions');
  row2.append(queue, again);
  b.appendChild(row2);

  out().replaceChildren(b);
}

function renderExpired() {
  const b = box('bad', 'Votre session a expiré.', 'Reconnectez-vous pour continuer.');
  const a = el('a', 'Aller à la connexion'); a.href = '/'; a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderSignedOut() {
  const b = box('idle', 'Non connecté.', 'Seul un membre d\'un organisateur peut ajouter des événements.');
  const a = el('a', 'Se connecter'); a.href = '/'; a.className = 'btn';
  b.appendChild(a);
  out().replaceChildren(b);
}

/**
 * One DATE of a repeating event, cancelled or moved.
 *
 * Edit mode only: an exception is keyed by (event_id, occurrence_date), so
 * there is nothing to attach one to until the event exists. Rendered as its
 * own box rather than as fields, because these are rows in another table with
 * their own lifetime -- adding one is a separate act from saving the event,
 * and pretending otherwise would mean an unsaved form silently holding
 * exceptions that are already in the database.
 */
function exceptionsSection(eventId, tz) {
  const b = box('idle', 'Exceptions',
    'Une seule date d\'un événement récurrent. Les dates annulées restent AFFICHÉES ' +
    'sur le site, signalées — « pas de practica le 15 août » rend plus service ' +
    'à un lecteur qu\'une semaine qui disparaît en silence.');

  const list = el('div', null, 'ex-list');
  const status = el('p', null, 'note');
  b.appendChild(list);

  const refresh = async () => {
    let rows;
    try { rows = await listExceptions(eventId); }
    catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      list.replaceChildren(el('p', `Chargement impossible : ${err.message}`, 'field-error'));
      return;
    }
    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(el('p', 'Aucune exception. Chaque occurrence a lieu comme prévu.', 'note'));
      return;
    }
    for (const x of rows) {
      const row = el('div', null, 'ex-row');
      row.appendChild(el('span', x.occurrence_date, 'ex-date'));
      row.appendChild(el('span', EXCEPTION_KINDS[x.kind] ?? x.kind,
        `tag tag-${x.kind === 'cancelled' ? 'rejected' : 'pending'}`));
      if (x.kind === 'moved' && x.moved_starts_at) {
        row.appendChild(el('span', `→ ${instantToInput(x.moved_starts_at, tz).replace('T', ' ')}`, 'muted'));
      }
      if (x.note) row.appendChild(el('span', x.note, 'muted'));
      const rm = el('button', 'Supprimer', 'btn btn-quiet');
      rm.type = 'button';
      rm.addEventListener('click', async () => {
        rm.disabled = true;
        status.textContent = 'Suppression…';
        try { await removeException(eventId, x.occurrence_date); status.textContent = ''; await refresh(); }
        catch (err) {
          if (err instanceof AuthExpired) return renderExpired();
          rm.disabled = false;
          status.textContent = `Échec : ${err.message}`;
        }
      });
      row.appendChild(rm);
      list.appendChild(row);
    }
  };

  // --- add one -------------------------------------------------------------
  const add = el('div', null, 'ex-add');
  const date = input('date');
  const kind = selectOf([{ value: 'cancelled', label: 'annulée' },
                         { value: 'moved', label: 'déplacée' }]);
  const note = input('text', { placeholder: 'Motif, affiché aux lecteurs (facultatif)' });
  const moved = input('datetime-local');
  const movedWrap = el('div', null, 'field');
  movedWrap.append(Object.assign(el('label', 'Déplacée au'), { htmlFor: 'ex-moved' }), moved);
  moved.id = 'ex-moved';

  const syncKind = () => { movedWrap.hidden = kind.value !== 'moved'; };
  kind.addEventListener('change', syncKind);
  syncKind();

  const addBtn = el('button', 'Ajouter une exception', 'btn btn-quiet');
  addBtn.type = 'button';
  addBtn.addEventListener('click', async () => {
    if (!date.value) { status.textContent = 'Choisissez une date.'; date.focus(); return; }
    if (kind.value === 'moved' && !moved.value) {
      status.textContent = 'Une occurrence déplacée a besoin d\'une nouvelle date et heure.';
      moved.focus();
      return;
    }
    addBtn.disabled = true;
    status.textContent = 'Ajout…';
    try {
      await addException({
        event_id: eventId,
        occurrence_date: date.value,          // a DATE. No time, deliberately.
        kind: kind.value,
        note: note.value.trim() || null,
        moved_starts_at: kind.value === 'moved' ? inputToInstant(moved.value, tz) : null,
      });
      date.value = ''; note.value = ''; moved.value = '';
      status.textContent = '';
      await refresh();
    } catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      status.textContent = `Refusé : ${err.message}`;
    } finally {
      addBtn.disabled = false;
    }
  });

  add.append(date, kind, note, addBtn);
  b.append(add, movedWrap, status);
  refresh();
  return b;
}

/**
 * The flyer.
 *
 * READ-ONLY IN CREATE MODE, and the reason is the same one the exceptions
 * section has: the storage path contains the event's id, and a new event does
 * not have one until the database assigns it. Offering a file picker that
 * could only fail would be worse than saying so.
 *
 * `image_path` is still the field that gets saved -- the upload only fills it
 * in. Nothing is written to the events row here; press save as usual. That
 * separation is deliberate: an upload that succeeded and a row that was never
 * saved leaves an unreferenced object, which is recoverable, while a row
 * pointing at an object that failed to upload is a broken image on the site.
 */
function imageField(existing) {
  const wrap = el('div', null, 'field');
  wrap.appendChild(el('label', 'Affiche'));

  // The saved value. Shown, never typed: image.js builds the path, because the
  // bucket policy checks the first segment against is_member() and a typed
  // path could be refused for a reason nothing on screen explains.
  const pathInput = input('text', { value: existing?.image_path ?? '', readOnly: true });
  pathInput.id = 'image_path';
  pathInput.name = 'image_path';
  pathInput.className = 'readonly';
  fields.set('image_path', { control: pathInput, err: el('p'), wrap });

  if (!existing) {
    wrap.appendChild(pathInput);
    wrap.appendChild(el('p',
      'Enregistrez d\'abord l\'événement : le chemin de l\'affiche contient son '
      + 'identifiant, qui n\'existe pas encore.', 'hint'));
    return wrap;
  }

  const row = el('div', null, 'ex-add');
  const picker = input('file');
  picker.accept = Object.keys(ALLOWED).join(',');
  const upBtn = el('button', 'Téléverser', 'btn btn-quiet');
  upBtn.type = 'button';
  const clearBtn = el('button', 'Retirer', 'btn btn-quiet');
  clearBtn.type = 'button';
  row.append(picker, upBtn, clearBtn);

  const status = el('p', null, 'note');
  const setStatus = (text, cls) => {
    status.textContent = text;
    status.className = cls ? `note ${cls}` : 'note';
  };

  upBtn.addEventListener('click', async () => {
    const file = picker.files?.[0];
    const problems = checkImage(file);
    if (problems.length) return setStatus(problems.join(' '), 'bad-text');

    upBtn.disabled = true;
    setStatus('Téléversement…');
    try {
      const target = storagePathFor(existing.organizer_id, existing.id, file.name);
      await uploadEventImage(target, file);
      pathInput.value = target;
      setStatus('Téléversée. Enregistrez pour l\'associer à l\'événement.', 'good-text');
    } catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      // A 403 here is the bucket policy, not the session: the first path
      // segment has to be an organizer you belong to.
      setStatus(`Refusé : ${err.message}`, 'bad-text');
    } finally {
      upBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    pathInput.value = '';
    setStatus('Chemin effacé. Le fichier reste dans Storage ; enregistrez pour '
      + 'retirer l\'affiche de la page.', 'good-text');
  });

  wrap.append(pathInput, row, status);
  wrap.appendChild(el('p',
    'JPEG, PNG, WebP ou AVIF, 5 Mo maximum. L\'image est téléchargée depuis '
    + 'Storage au moment de la construction du site et optimisée par Astro ; '
    + 'rien sur le site public ne pointe vers Supabase.', 'hint'));
  return wrap;
}

async function boot() {
  if (!out()) return;
  if (!hasSession()) return renderSignedOut();
  out().replaceChildren(box('idle', 'Chargement…'));

  let session;
  try { session = await getSession(); } catch { return renderExpired(); }

  const id = new URLSearchParams(location.search).get('id');

  try {
    const [memberships, existing] = await Promise.all([
      myOrganizers(),
      id ? getEvent(id) : Promise.resolve(null),
    ]);

    const organizers = memberships
      .map((m) => m.organizers)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!organizers.length) {
      // Signed in and a member of nothing. Say exactly that: it is a
      // membership problem, and signing in again cannot fix it.
      const claims = claimsOf(session.access_token);
      const b = box('bad', 'Vous n\'êtes membre d\'aucun organisateur.',
        'Créer un événement exige is_member(organizer_id), et être administrateur ' +
        'ne remplace pas cela : il n\'existe pas de politique d\'insertion pour l\'admin.');
      const dl = el('dl');
      dl.append(el('dt', 'connecté en tant que'), el('dd', claims.email ?? '—'));
      b.appendChild(dl);
      return out().replaceChildren(b);
    }

    if (id && !existing) {
      return out().replaceChildren(box('bad', 'Cet événement ne vous est pas visible.',
        'Soit il n\'existe pas, soit le RLS le masque — la base donne délibérément ' +
        'la même réponse aux deux, pour que cette page ne serve pas à deviner ' +
        'quels événements existent.'));
    }

    const wrap = box('idle', existing ? 'Modifier l\'événement' : 'Nouvel événement',
      existing
        ? 'Modifier un événement publié le laisse en ligne et le place dans la file d\'attente.'
        : 'Créé en attente. C\'est la file d\'attente qui le publie.');

    const form = buildForm(organizers, existing);
    const status = el('p', null, 'note');
    const submit = el('button', existing ? 'Enregistrer' : 'Créer l\'événement', 'btn');
    submit.type = 'submit';
    const actions = el('div', null, 'actions');
    actions.appendChild(submit);
    form.append(actions, status);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save(existing, status, submit);
    });

    wrap.appendChild(form);

    const frag = document.createDocumentFragment();
    frag.appendChild(wrap);
    // Only when the event exists: an exception is keyed by its id.
    if (existing) frag.appendChild(exceptionsSection(existing.id, existing.timezone ?? 'Europe/Paris'));
    out().replaceChildren(frag);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    const b = box('bad', 'Le formulaire n\'a pas pu être chargé.', String(err.message));
    out().replaceChildren(b);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
