// Serve editor/public on http://localhost:3000, pointed at the DEV project.
//
//     npm run dev:editor
//
// WHY PORT 3000, AND WHY IT IS NOT A PREFERENCE. Dev's Supabase Site URL is
// `http://localhost:3000` -- the scaffold default, never changed, measured
// 2026-09-23 with the /auth/v1/verify probe in editor/README.md. site_url is
// also the fallback for any redirect_to that is not allow-listed, so a magic
// link from the dev project lands on port 3000 whatever this script does.
// Serving anywhere else means links arrive at a closed port. The port is part
// of the auth configuration; changing it means changing the dashboard first.
//
// It is the origin that selects the project (editor/public/target.js), so
// nothing here passes a key or a flag: serving from localhost IS the choice of
// dev, and it is not expressible any other way.
//
// This mirrors the Cache-Control headers `editor/public/_headers` sets on
// Cloudflare, so a page that must not be cached is not cached here either --
// /organizer/ in particular renders organizers.email and .phone, which are
// private on every project including this one.
//
// It does NOT send the production CSP. A local static server is not the
// deployment, and pretending otherwise would be the more misleading of the two
// choices: the real policy is in _headers and is enforced by Cloudflare. What
// that means in practice is that a CSP mistake will not show up here -- check
// it against the deployed preview, not against this.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../editor/public/', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Same paths _headers marks no-store, for the same reasons.
const NO_STORE = [/^\/auth\/callback\/?$/, /^\/queue\/?$/, /^\/event\/?$/, /^\/organizer\/?$/];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  // Directory -> index.html, so /queue/ works the way Cloudflare serves it.
  let filePath = join(ROOT, normalize(pathname));
  // normalize() collapses ".." before this check, so a path that escaped the
  // root no longer starts with it. Refuse rather than serve the repo.
  if (!filePath.startsWith(ROOT.replace(new RegExp(`${sep}$`), '') + sep)
      && filePath !== ROOT.replace(new RegExp(`${sep}$`), '')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Fall through: readFile reports it.
  }

  try {
    const body = await readFile(filePath);
    const headers = { 'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream' };
    if (NO_STORE.some((re) => re.test(pathname))) {
      headers['Cache-Control'] = 'no-store, must-revalidate';
    }
    headers['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
       .end(`404 ${pathname}\n`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  editor  http://localhost:%d/', PORT);
  console.log('  project DEV — hjsekipqryfuwdkhxuks');
  console.log('');
  console.log('  The origin picks the project (editor/public/target.js), so this');
  console.log('  cannot reach production. A banner on every page says so.');
  console.log('');
  console.log('  Nothing to sign in with yet?   ./scripts/seed-dev-editor.sh --help');
  console.log('');
});
