// Edit an organizer.
//
// `/organizer/` lists the ones you belong to; `/organizer/?id=<uuid>` edits one.
//
// THERE IS NO CREATE, and that is the database's decision. `authenticated`
// holds no INSERT and no DELETE grant on public.organizers, so even the admin
// policy cannot be exercised from a user token. A "New organizer" button would
// 403 every time it was pressed. Creating one is the dashboard or service_role.
//
// AND NOT EVERY MEMBER MAY SAVE. `organizers_owner_update` requires
// is_owner(id) -- role = 'owner' in organizer_members. An EDITOR can read the
// row and create events for it and cannot change its name. That is a narrower
// permission than the events form needs, so this page asks the database both
// questions (is_owner, is_admin) rather than inferring either from the
// membership list it already has.
//
// THE POINT OF THIS PAGE IS THE TWO PAIRS OF CONTACT FIELDS, and that they are
// not the same thing:
//
//   email / phone                  PRIVATE. Readable by members here, absent
//                                  from organizers_public, never in the build.
//   contact_email / contact_phone  PUBLIC. On the event page, permanently, and
//                                  only with a recorded consent beside them --
//                                  organizers_contact_*_needs_consent refuses
//                                  the value otherwise.
//
// Those columns exist (2026-09-22) because their absence was the cause of the
// leak verify-build.mjs warns about: with nowhere sanctioned to put a phone
// number, it went into an event's free text. A form that made the two pairs
// look alike would recreate the problem in a new place, which is why they are
// separated on screen and labelled by what happens to them rather than by
// which column they are.

import { getSession, hasSession, claimsOf } from '/auth.js';
import {
  myOrganizers, getOrganizer, updateOrganizer, isAdmin, isOwner,
  listMembers, addMember, removeMember, AuthExpired,
} from '/api.js';
import { validateOrganizer } from '/validate.js';
import { consentFor } from '/consent.js';
import '/banner.js';
import '/admin-only.js';   // side effect: hides the queue link unless this account is an admin
import '/signout-button.js';   // side effect: names the project when it is not production

const out = () => document.querySelector('#out');

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
const val = (n) => fields.get(n).control.value.trim();

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

// --- reading the form -------------------------------------------------------

/**
 * Read one contact pair out of the form and into column names.
 *
 * THE SECOND ARGUMENT IS NOW ALWAYS TRUE, and consentFor is kept rather than
 * bypassed. Since 2026-10-22 entering a value IS the consent, so there is no
 * box to read -- but the three cases that function encodes have not gone
 * anywhere, and the middle one is still the one that gets written wrong:
 * re-saving an unchanged row must keep the ORIGINAL stamp, because when
 * somebody agreed is the entire content of that column. Passing `true` and
 * letting consentFor decide preserves that; writing `now()` here would look
 * identical on screen and quietly destroy the record on every save.
 */
function contactPair(kind) {
  const { value, consentAt } = consentFor(
    val(`contact_${kind}`),
    true,
    fields.get(`contact_${kind}`).wasConsentAt ?? null,
  );
  return {
    [`contact_${kind}`]: value,
    [`contact_${kind}_consent_at`]: consentAt,
  };
}

function readForm() {
  return {
    name: val('name'),
    website: val('website') || null,
    instagram: val('instagram') || null,
    facebook: val('facebook') || null,
    tiktok: val('tiktok') || null,
    // `email` and `phone` are NOT sent: the form stopped asking for them on
    // 2026-10-22, and sending null would erase what production already holds
    // rather than leave it alone. Omitting a column from a PATCH leaves it.
    ...contactPair('email'),
    ...contactPair('phone'),
  };
}

/**
 * The shape validateOrganizer() reads: the RAW typed values, plus the boxes.
 *
 * The contact fields are deliberately re-read from the controls rather than
 * taken from readForm(), and that is not a tidiness point. readForm() has
 * already applied consentFor(), which nulls an unconsented value -- so
 * validating its output asked "is there an unconsented value?" of an object
 * that can never contain one. The answer was always no, the form said "Saved",
 * and what somebody typed was dropped on the floor.
 *
 * Found by filling the field and pressing Save, which is the only way it was
 * ever going to be found: every unit test passes raw values straight to
 * validateOrganizer and so never exercised this wiring.
 */
function forValidation(v) {
  return {
    ...v,
    contact_email: val('contact_email') || null,
    contact_phone: val('contact_phone') || null,
    // Consent is implied by there being a value, so these are no longer read
    // from a control -- they ARE the value's presence.
    //
    // NOT a hard `true`, which is what this said first and would have blocked
    // every organizer who leaves these empty: validateOrganizer's second rule
    // is `!value && consent` -> "Rien à publier : remplissez ce champ, ou
    // décochez la case", and with consent always true that fires on every
    // blank field, pointing at a checkbox that no longer exists. Most
    // organizers publish neither, so most saves would have been refused.
    //
    // Both of that function's consent rules are now unreachable from this
    // form, which is correct: with no box, neither "typed but not ticked" nor
    // "ticked but not typed" can occur. They stay in validate.js because it is
    // a pure function with its own tests, and because the rules still describe
    // the database's constraint truthfully.
    contact_email_consented: !!val('contact_email'),
    contact_phone_consented: !!val('contact_phone'),
    contact_email_was_consented: !!fields.get('contact_email').wasConsentAt,
    contact_phone_was_consented: !!fields.get('contact_phone').wasConsentAt,
  };
}

// --- the form ---------------------------------------------------------------

function buildForm(org) {
  const form = el('form', null, 'event-form');
  fields.clear();

  const section = (title, note) => {
    form.appendChild(el('h3', title, 'section'));
    if (note) form.appendChild(el('p', note, 'hint'));
  };

  section('Identité');
  form.appendChild(field('name', 'Nom', input('text', { value: org.name ?? '' }),
    { required: true }));

  // Shown, not editable, and the reason is worth one line on screen: `slug` is
  // not in the UPDATE grant, so this is the database's position rather than a
  // UI choice. Every event URL contains it.
  const slug = input('text', { value: org.slug ?? '', disabled: true });
  form.appendChild(field('slug', 'Identifiant d\'URL', slug,
    { hint: 'Fixe. Il figure dans chaque lien vers cet organisateur, il ne peut donc pas changer.' }));

  section('Liens',
    'Des identifiants, pas des adresses. Saisissez « nissartango » ; le site construit le lien.');
  form.appendChild(field('website', 'Site web', input('url', { value: org.website ?? '' }),
    { hint: 'Adresse complète, commençant par https://.' }));
  // Per-field hints, because the section heading saying "identifiants, pas
  // adresses" was not enough: all three were filled with URLs, and a hint that
  // names the platform's own address form is what makes the ask concrete.
  const LINK_HINTS = [
    ['instagram', 'Instagram', 'La partie après instagram.com/ — « nissartango ».'],
    ['facebook', 'Facebook',
      'Le nom d\'utilisateur de votre page, après facebook.com/ — « nissartango ». '
      + 'Si votre adresse contient « profile.php?id=… », la page n\'en a pas encore.'],
    ['tiktok', 'TikTok', 'La partie après tiktok.com/@, sans le « @ » — « nissartango ».'],
  ];
  for (const [k, label, hint] of LINK_HINTS) {
    form.appendChild(field(k, label, input('text', { value: org[k] ?? '' }), { hint }));
  }

  // THE PRIVATE PAIR IS NO LONGER ON THIS FORM, as of 2026-10-22. `email` and
  // `phone` still exist as columns, `authenticated` still holds a column-level
  // UPDATE on them, and whatever production already holds is untouched -- they
  // are simply not asked for any more. The address that reaches an organizer
  // is the one on their account, which is where it was always going to be
  // looked up anyway, so the fields duplicated a fact nobody edited.
  //
  // They are still absent from organizers_public. THAT is the privacy
  // boundary, and removing two inputs does not move it.

  section('Vos coordonnées — publiées sur chacun de vos événements',
    'Elles apparaissent sur le site sous forme de liens, visibles par tout le monde. ' +
    'Laissez-les vides si vous préférez ne pas publier de moyen de vous contacter.');

  for (const [kind, label, type, hint] of [
    ['email', 'E-mail public', 'email',
     'Publié tel quel sur la page de chacun de vos événements. Laissez vide pour ne rien publier.'],
    ['phone', 'Téléphone public', 'tel',
     'Publié tel quel sur la page de chacun de vos événements. Laissez vide pour ne rien publier.'],
  ]) {
    const name = `contact_${kind}`;
    form.appendChild(field(name, label, input(type, { value: org[name] ?? '' }), { hint }));
    // The stamp travels on the field, so readForm can preserve it without a
    // second lookup and without a module-level variable.
    fields.get(name).wasConsentAt = org[`${name}_consent_at`] ?? null;
  }

  // THE TICK BOX IS GONE AND THE STAMP IS NOT. organizers_contact_*_needs_consent
  // refuses a value without one, so the form must still send a timestamp or the
  // save fails outright in the database -- removing the checkbox alone would
  // have broken saving a public e-mail, not simplified it.
  //
  // What the stamp MEANS has changed, and that is the honest cost: it recorded
  // "they ticked a box saying permanently public", and now records "they typed
  // it into a field whose label says it is published on every event page".
  // Weaker evidence, still a record, and the label is what carries the warning
  // the checkbox used to -- which is why both hints above say it twice.
  //
  // Withdrawal is unchanged: clearing the field nulls the value and KEEPS the
  // stamp, so the fact that publication was once agreed to survives. See
  // consent.js, case 3.

  return form;
}

async function save(org, status, submit) {
  const v = readForm();
  const problems = validateOrganizer(forValidation(v));
  showErrors(problems);
  if (problems.length) {
    status.textContent = `${problems.length} point(s) à corriger.`;
    return;
  }

  submit.disabled = true;
  status.textContent = 'Enregistrement…';
  try {
    const saved = await updateOrganizer(org.id, v);
    if (!saved) {
      // PATCH returning no row means the UPDATE matched nothing, and with
      // return=representation that is what a policy refusal looks like -- not
      // an error. Say what it actually means rather than "saved".
      status.textContent =
        'Rien n\'a été enregistré : la base n\'a pas accepté la modification. ' +
        'Modifier un organisateur demande d\'en être propriétaire.';
      return;
    }
    status.textContent = 'Enregistré.';
    // Re-read what the database stored rather than what was sent: the consent
    // stamp may have just been created, and the next save has to preserve it.
    for (const kind of ['email', 'phone']) {
      fields.get(`contact_${kind}`).wasConsentAt = saved[`contact_${kind}_consent_at`] ?? null;
    }
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    status.textContent = `Refusé : ${err.message}`;
  } finally {
    submit.disabled = false;
  }
}

// --- states -----------------------------------------------------------------

/**
 * Who may use this organizer, and adding somebody by email.
 *
 * OWNER OR ADMIN ONLY, which the database enforces in the functions themselves
 * -- this section is simply not rendered otherwise, because a form that 403s on
 * submit teaches nothing.
 *
 * BY EMAIL, because that is the only identifier a person has. Until
 * 20261003120000 adding a member meant finding their uuid in the Supabase
 * dashboard, so onboarding one organizer was three SQL statements and a lookup.
 *
 * THEY MUST HAVE SIGNED IN ONCE. organizer_members.user_id references
 * auth.users, so there is nothing to point at until an account exists. That is
 * the NT006 case below, and it gets a specific message because it is the one
 * failure the person on the other end can actually fix.
 */
function membersSection(org) {
  const b = box('idle', 'Membres',
    'Ajoutez les personnes qui peuvent créer et modifier vos événements, '
    + 'si vous le souhaitez. Vous pouvez très bien rester seul.');
  const list = el('div', null, 'members');
  const status = el('p', null, 'note');

  async function refresh() {
    try {
      const rows = await listMembers(org.id);
      list.replaceChildren();
      for (const m of rows) {
        const row = el('div', null, 'member');
        const who = el('div', null, 'member-who');
        who.append(el('span', m.email, 'member-email'),
                   el('span', m.role === 'owner' ? 'propriétaire' : 'éditeur', 'tag'));

        // NO « Retirer » ON A PROPRIÉTAIRE, as of 2026-10-22. On the common
        // shape -- one owner, who is the person reading this -- that button
        // could only ever fail: t50_members_keep_an_owner refuses to leave an
        // organizer with no owner, so it offered to do something the database
        // was always going to refuse, and answered with an error code.
        //
        // A co-owner is not stranded by this. Re-adding them below as
        // « Éditeur » changes the role in place -- add_organizer_member ends
        // `on conflict (organizer_id, user_id) do update set role` -- and the
        // button comes back on the next refresh. Demote, then remove.
        if (m.role === 'owner') { row.append(who); list.appendChild(row); continue; }

        const rm = el('button', 'Retirer', 'btn btn-quiet btn-small');
        rm.type = 'button';
        rm.addEventListener('click', async () => {
          rm.disabled = true;
          status.textContent = `Retrait de ${m.email}…`;
          status.className = 'note';
          try {
            await removeMember(org.id, m.user_id);
            status.textContent = '';
            await refresh();
          } catch (err) {
            if (err instanceof AuthExpired) return renderExpired();
            rm.disabled = false;
            // t50_members_keep_an_owner refuses to leave an organizer with no
            // owner, and says so in its own words.
            status.textContent = `Refusé : ${err.message}`;
            status.className = 'note bad-text';
          }
        });
        row.append(who, rm);
        list.appendChild(row);
      }
      if (!rows.length) list.appendChild(el('p', 'Aucun membre.', 'note'));
    } catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      list.replaceChildren(el('p', `Liste indisponible : ${err.message}`, 'note bad-text'));
    }
  }

  const addWrap = el('div', null, 'field');
  addWrap.appendChild(el('label', 'Ajouter par e-mail'));
  const row = el('div', null, 'member-add');
  const mail = input('email', { placeholder: 'personne@exemple.fr' });
  const role = el('select');
  for (const [value, label] of [['editor', 'Éditeur'], ['owner', 'Propriétaire']]) {
    const o = el('option', label);
    o.value = value;
    role.appendChild(o);
  }
  const add = el('button', 'Ajouter', 'btn');
  add.type = 'button';
  row.append(mail, role, add);
  addWrap.append(row, el('p',
    'La personne doit déjà avoir un compte : l\'éditeur ne permet pas d\'en '
    + 'créer un soi-même. Invitez-la depuis le tableau de bord Supabase '
    + '(Authentication → Users → Invite user), puis ajoutez-la ici. '
    + 'Ajouter quelqu\'un de déjà membre change son rôle.', 'hint'));

  add.addEventListener('click', async () => {
    const email = mail.value.trim();
    if (!email) { status.textContent = 'Saisissez une adresse.'; mail.focus(); return; }
    add.disabled = true;
    status.textContent = 'Ajout…';
    status.className = 'note';
    try {
      await addMember(org.id, email, role.value);
      mail.value = '';
      status.textContent = '';
      await refresh();
    } catch (err) {
      if (err instanceof AuthExpired) return renderExpired();
      // NT006 is the one failure the owner can act on, so it says what to DO.
      // It used to say "ask them to sign in once", which cannot work:
      // requestLink() sends create_user: false, so an unknown address is
      // refused with "Signups not allowed for otp". Found by rehearsing the
      // flow, 2026-10-03.
      status.textContent = err.code === 'NT006'
        ? `Aucun compte pour ${email}. Invitez cette adresse depuis le tableau `
          + 'de bord Supabase (Authentication → Users → Invite user), puis réessayez.'
        : `Refusé : ${err.message}`;
      status.className = 'note bad-text';
    } finally {
      add.disabled = false;
    }
  });

  b.append(list, addWrap, status);
  refresh();
  return b;
}

function renderSignedOut() {
  const b = box('idle', 'Non connecté.', 'Cette page nécessite une session.');
  const a = el('a', 'Se connecter');
  a.href = '/';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderExpired() {
  const b = box('bad', 'Votre session a expiré.',
    'Un rafraîchissement a été tenté sans succès : se reconnecter est le seul moyen de continuer.');
  const a = el('a', 'Se connecter');
  a.href = '/';
  b.appendChild(a);
  out().replaceChildren(b);
}

function renderList(organizers) {
  const b = box('idle', 'Vos organisateurs',
    'Choisissez-en un à modifier. Seul un propriétaire peut enregistrer des ' +
    'changements ; un éditeur peut créer des événements sans pouvoir renommer l\'organisateur.');
  const ul = el('ul', null, 'list');
  for (const { org, role } of organizers) {
    const li = el('li');
    const a = el('a', org.name);
    a.href = `/organizer/?id=${encodeURIComponent(org.id)}`;
    li.append(a, el('span', ` — ${role}`, 'note'));
    ul.appendChild(li);
  }
  b.appendChild(ul);
  out().replaceChildren(b);
}

// --- boot -------------------------------------------------------------------

async function boot() {
  if (!out()) return;
  if (!hasSession()) return renderSignedOut();
  out().replaceChildren(box('idle', 'Chargement…'));

  let session;
  try { session = await getSession(); } catch { return renderExpired(); }

  const id = new URLSearchParams(location.search).get('id');

  try {
    const memberships = await myOrganizers();
    const mine = memberships
      .filter((m) => m.organizers)
      .map((m) => ({ org: m.organizers, role: m.role }))
      .sort((a, b) => a.org.name.localeCompare(b.org.name));

    if (!mine.length) {
      const claims = claimsOf(session.access_token);
      const b = box('bad', 'Vous n\'êtes membre d\'aucun organisateur.',
        'Il n\'y a rien à modifier ici. L\'appartenance est accordée dans ' +
        'organizer_members, et être administrateur n\'en crée pas une.');
      const dl = el('dl');
      dl.append(el('dt', 'connecté en tant que'), el('dd', claims.email ?? '—'));
      b.appendChild(dl);
      return out().replaceChildren(b);
    }

    if (!id) return renderList(mine);

    // Both questions go to the database. `mine` already carries a role, but an
    // admin may edit an organizer they do not own, and a stale membership row
    // in this page's memory is not the thing the policy consults.
    const [org, admin, owner] = await Promise.all([
      getOrganizer(id), isAdmin(), isOwner(id),
    ]);

    if (!org) {
      return out().replaceChildren(box('bad', 'Cet organisateur ne vous est pas visible.',
        'Soit il n\'existe pas, soit le RLS le masque — la base donne ' +
        'délibérément la même réponse aux deux cas.'));
    }

    const mayWrite = owner || admin;
    const wrap = box('idle', `Modifier ${org.name}`,
      mayWrite
        ? 'Les changements sont en ligne dès l\'enregistrement. Les événements ne sont pas touchés.'
        : null);

    const form = buildForm(org);
    const status = el('p', null, 'note');
    const submit = el('button', 'Enregistrer', 'btn');
    submit.type = 'submit';

    if (!mayWrite) {
      // Disable and SAY WHY. A form that looks writable and 403s on save
      // teaches nothing; this is a membership fact the person can act on.
      submit.disabled = true;
      for (const { control } of fields.values()) control.disabled = true;
      wrap.appendChild(box('bad', 'Vous pouvez consulter, mais pas modifier.',
        'organizers_owner_update exige d\'être PROPRIÉTAIRE de cet organisateur. ' +
        'Vous en êtes éditeur, ce qui vous permet de créer des événements. ' +
        'Demandez à un propriétaire, ou à un administrateur, de modifier ces informations.'));
    }

    const actions = el('div', null, 'actions');
    actions.appendChild(submit);
    form.append(actions, status);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (mayWrite) save(org, status, submit);
    });

    wrap.appendChild(form);

    const frag = document.createDocumentFragment();
    frag.appendChild(wrap);
    if (mayWrite) frag.appendChild(membersSection(org));
    const back = el('p', null, 'note');
    const a = el('a', '← Tous vos organisateurs');
    a.href = '/organizer/';
    back.appendChild(a);
    frag.appendChild(back);
    out().replaceChildren(frag);
  } catch (err) {
    if (err instanceof AuthExpired) return renderExpired();
    out().replaceChildren(box('bad', 'Le formulaire n\'a pas pu être chargé.', String(err.message)));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
