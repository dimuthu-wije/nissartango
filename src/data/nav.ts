/**
 * The site's navigation, in ONE place.
 *
 * Until 2026-10-09 there was no navigation at all: the header held the
 * wordmark and nothing else, and /archives/ was reachable only from a line at
 * the bottom of the agenda. Four of five event pages had already been
 * unreachable once for the same reason (Outstanding 4), which is what the
 * build's reachability check exists to stop happening again.
 *
 * Blog, articles, contacts and media are coming. Adding one is a line here,
 * which is the whole point of the array: a nav assembled in the layout's
 * markup is a nav that gets edited in two places the day a page is renamed.
 *
 * TRAILING SLASH, ALWAYS. Cloudflare's asset router serves <slug>/index.html
 * at /<slug>/ and 301s the bare /<slug>. verify-build check 8 fails on any
 * emitted URL that would redirect, so an entry written without the slash is a
 * failed build rather than a slow link -- which is the right way round.
 */
export interface NavItem {
  href: string;
  label: string;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Agenda' },
  { href: '/archives/', label: 'Archives' },
];

/**
 * Whether a nav entry describes the page being rendered.
 *
 * EXACT MATCH, deliberately, not a prefix. An event page is reachable from
 * both listings and belongs to whichever one still lists it -- the agenda if
 * it is upcoming, the archive once it is not -- and the layout cannot know
 * which. Marking "Agenda" current on every /evenements/ page would be a
 * guess that is wrong half the time, so no entry is marked there at all and
 * the page's own "← Agenda" link does the work.
 */
export function isCurrent(href: string, pathname: string): boolean {
  const norm = (p: string) => (p.endsWith('/') ? p : `${p}/`);
  return norm(href) === norm(pathname);
}
