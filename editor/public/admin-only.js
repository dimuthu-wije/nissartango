/**
 * Hide what only an administrator can use.
 *
 * WHY. Signing in as somebody who is not an admin still offered "Ouvrir la file
 * d'attente" as the primary button, and every page's footer linked to it. The
 * page it leads to then explains, correctly and at length, that is_admin()
 * answered false. That explanation is right for a maintainer debugging a
 * membership; it is wrong as the first thing an invited organizer meets, and it
 * invites them to click something that was never theirs.
 *
 * HIDDEN, NOT DISABLED — and that is a departure from what this editor does
 * elsewhere, so it is worth saying why. A disabled control with its reason
 * beside it (recurrence_end, Autres dates, the delete section) teaches a rule
 * the person can SATISFY: choose a single date, become an owner. The moderation
 * queue is not a rule to satisfy. It is somebody else's page, and an organizer
 * will never become an administrator of this agenda. Showing it greyed out with
 * an explanation would be explaining a door that is not theirs to open.
 *
 * HIDDEN FIRST, REVEALED AFTER. is_admin() is a round trip, so the alternative
 * -- show it, then take it away -- flashes a control and removes it, which
 * reads as a bug. An admin waits a beat for the link instead.
 *
 * THE ANSWER COMES FROM THE DATABASE, once per page. Not from a JWT claim: this
 * project deliberately keeps the admin flag in user_roles rather than in the
 * token (see docs/BRIEFING-stage5.md), so a role change takes effect on the
 * next request instead of at the next token refresh.
 *
 * NONE OF THIS IS A SECURITY BOUNDARY. The queue page checks is_admin() itself,
 * every admin RPC checks it again, and RLS refuses regardless. This is about
 * not offering somebody a door they cannot open.
 */
import { isAdmin } from '/api.js';
import { hasSession } from '/auth.js';

let answer = null;

/** One call per page, whatever asks. */
function amAdmin() {
  if (!answer) {
    answer = hasSession()
      ? isAdmin().catch(() => false)   // a refusal is an answer: not an admin
      : Promise.resolve(false);
  }
  return answer;
}

/** Hide `node` now; show it only if this account is an administrator. */
export function adminOnly(node) {
  if (!node) return node;
  node.hidden = true;
  amAdmin().then((ok) => { node.hidden = !ok; });
  return node;
}

// The footer link every page carries. Done on import so a page gets this by
// importing one module, the same way signout-button.js works.
//
// IT TARGETS THE WRAPPER, NOT THE LINK. Hiding the <a> on its own left the
// separator behind -- "Une fois connecté : · événements · organisateur" --
// because the " · " is a text node beside the link, not inside it. Each footer
// wraps the link AND its separator in <span data-admin-only>.
for (const node of document.querySelectorAll('[data-admin-only]')) adminOnly(node);
