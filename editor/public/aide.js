// The guide page carries no behaviour of its own: it is prose. These two are
// the same side effects every other page takes — the dev banner, and hiding the
// moderation queue from people who are not moderators.
//
// A module rather than inline <script> because _headers sets script-src 'self'
// with no 'unsafe-inline'.
import '/banner.js';
import '/admin-only.js';
