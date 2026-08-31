// @ts-check
import { defineConfig } from 'astro/config';


// https://astro.build/config
export default defineConfig({
  site: 'https://nissartango.fr',

  // The server already does this: pages build to <slug>/index.html and
  // Cloudflare's asset router 301s /path to /path/. Declaring it here makes
  // every URL Astro generates agree with what the server actually serves,
  // instead of emitting the no-slash form and letting a redirect fix it.
  trailingSlash: 'always',

  // No i18n block. It declared an 'en' locale the site has no pages for, which
  // is what put a header link on /en/ and made it 404. The site is French; if
  // an English version is ever built, the config comes back with the pages.

});