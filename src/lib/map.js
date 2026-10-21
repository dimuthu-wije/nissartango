/**
 * A link to the place an event happens, on Google Maps.
 *
 * ONE FUNCTION, AND IT MAY RETURN NULL. `city` defaults to 'Nice' in the
 * schema, so it is present on every event and a query built from it alone
 * always "works": Google answers with the middle of Nice. That is a link that
 * looks helpful and tells you nothing, which is worse than no link, because a
 * reader who follows it once learns not to follow it again. So a venue name or
 * a street address is required and the city alone is not enough.
 *
 * THE FORMAT IS GOOGLE'S DOCUMENTED Maps URLs API -- /maps/search/ with
 * `api=1` -- and not the older `maps.google.com/?q=`. Recorded as a CLAIM about
 * Google plus one measurement against it on 2026-10-21: the URL below was
 * loaded and Google accepted it, carrying the whole encoded query intact
 * through its French consent redirect. Accepted, not rendered -- the consent
 * interstitial was not clicked through, so what the map finally shows for a
 * given string is still unmeasured.
 *
 * WHAT A FRENCH VISITOR ACTUALLY MEETS, measured the same day: the first click
 * lands on consent.google.com, not on a map. That is every Google link from
 * France, once per browser, and it is not something this site can avoid or
 * should try to.
 *
 * THE VENUE NAME GOES IN THE QUERY, not just the address. "La Casita del
 * Tango, 12 rue Gubernatis" resolves when either half is slightly wrong;
 * a street alone has nothing to correct itself against.
 */
const BASE = 'https://www.google.com/maps/search/?api=1&query=';

/**
 * The address as one line, or null when there is nothing worth searching.
 *
 * THE POSTCODE AND THE CITY ARE ONE FIELD, joined by a space and not by a
 * comma: "06000 Nice" is how a French address is written, and it is how the
 * event page itself renders that line. Joining all four parts with commas gave
 * "06000, Nice" -- which Google copes with, and which no French reader would
 * write. The query a person sees in the Maps search box should look like the
 * address they just read.
 */
export function mapsQuery(e) {
  if (!e?.location_name && !e?.location_address) return null;
  const town = [e.location_postal_code, e.city].filter(Boolean).join(' ');
  return [e.location_name, e.location_address, town]
    .filter(Boolean)
    .join(', ');
}

/** The Google Maps URL for an event, or null when it would point at a city. */
export function mapsUrl(e) {
  const q = mapsQuery(e);
  return q ? BASE + encodeURIComponent(q) : null;
}
