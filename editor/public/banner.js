// A strip across the top saying which project this page is talking to,
// whenever that is not production.
//
// WHY ONLY WHEN IT IS NOT PRODUCTION. A banner that is always there is
// furniture: it stops being read within a day, and then it cannot warn anyone
// of anything. This one appears exactly when the answer is surprising, so its
// presence is the information.
//
// The failure it exists for is the quiet one in the other direction, though --
// believing you are on dev while editing the live agenda. That is why the
// production case shows nothing rather than a green "production" badge: a
// missing badge is noticed; a green one is not.
//
// Self-initialising on import, because `_headers` sets script-src 'self' with
// no 'unsafe-inline', so no page in this deployment may carry an inline
// <script> to call it.

import { IS_PRODUCTION, PROJECT_NAME, PROJECT_REF } from '/config.js';

export function showTargetBanner(doc = document) {
  if (IS_PRODUCTION) return null;

  const bar = doc.createElement('div');
  bar.className = 'target-banner';
  bar.setAttribute('role', 'status');

  const strong = doc.createElement('strong');
  strong.textContent = `Projet ${PROJECT_NAME}`;
  const rest = doc.createElement('span');
  // The REF, not just the name. The two project names are backwards -- dev is
  // called "nissartango-dev" and production is called "dimuthu-wije's Project"
  // -- so a name alone is exactly the thing that has misled people here
  // before. supabase/PROJECT_SETUP.md: read the ref, never the name.
  rest.textContent = ` — ${PROJECT_REF}. Rien de ce que vous faites ici `
    + `n'atteint le site public.`;

  bar.append(strong, rest);
  doc.body.prepend(bar);
  return bar;
}

showTargetBanner();
