/**
 * Signed in, and a member of nothing yet.
 *
 * WHY THIS IS A PAGE AND NOT AN ERROR. Attaching somebody to an organizer is
 * the one step of onboarding that is done by hand, and it cannot happen before
 * their account exists -- organizer_members.user_id references auth.users. So
 * there is a window, by construction, between "this person can sign in" and
 * "this person can do anything", and whoever walks into it has done nothing
 * wrong.
 *
 * Until 2026-10-18 they met the event form's membership box: a correct
 * explanation that is_member(organizer_id) answered false, in red, written for
 * a maintainer reading RLS. For the person it describes it reads as a refusal
 * they caused. Same state, two meanings -- so the ADMIN still gets the
 * technical box, and everybody else gets this.
 *
 * THE SIGNAL IS THE MEMBERSHIP ITSELF, not a flag. `myOrganizers()` returning
 * nothing IS the pending state: no column, no migration, nothing to switch off,
 * and it clears itself the moment the membership row exists. A stored
 * "validated" flag would be a second source of truth for a question the first
 * one already answers, and the two would eventually disagree.
 *
 * IT TELLS THEM NOT TO RETRY, which is the part that matters. They have no way
 * of seeing the admin finish, so without that sentence the only available
 * action is to ask for another link and meet this page again. The notification
 * is the admin's own message; this page's job is to make waiting for it the
 * obvious thing to do rather than the thing that feels like giving up.
 */
import { myOrganizers } from '/api.js';
import { amAdmin } from '/admin-only.js';

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;   // textContent: all of this is untrusted
  if (cls) n.className = cls;
  return n;
};

/**
 * Is this person waiting on the admin?
 *
 * A FAILED QUESTION IS NOT A YES. If the membership call throws -- an expired
 * token, PostgREST down -- this answers false and the caller shows whatever it
 * would have shown anyway. Answering true would turn every transient fault into
 * "your access is being prepared", which is a lie told confidently.
 */
export async function isPending() {
  try {
    const [memberships, admin] = await Promise.all([myOrganizers(), amAdmin()]);
    return memberships.length === 0 && !admin;
  } catch {
    return false;
  }
}

/** The waiting notice, as a ready `.box` to drop into the page. */
export function pendingBox(email) {
  const b = el('div', null, 'box idle');
  b.appendChild(el('h2', 'Votre accès est en préparation.'));
  b.appendChild(el('p',
    'Votre compte est créé. Il reste à le rattacher à votre fiche '
    + "d'organisateur : c'est la dernière étape, et elle est faite à la main "
    + "par l'administrateur de l'agenda."));
  b.appendChild(el('p',
    "Vous serez prévenu dès que c'est fait. Il n'y a rien à réessayer d'ici "
    + 'là — ce lien ne débloquera rien de plus, et en demander un autre non '
    + 'plus.'));
  b.appendChild(el('p',
    'Une fois prévenu, revenez sur editor.nissartango.fr et demandez un lien '
    + 'de connexion avec cette adresse.'));
  if (email) {
    const dl = el('dl');
    dl.append(el('dt', 'connecté en tant que'), el('dd', email));
    b.appendChild(dl);
  }
  return b;
}
