#!/usr/bin/env python3
"""A tiny stand-in for PostgREST + GoTrue + Storage, used only to test that
scripts/prove-rls.sh reports honestly. MODE selects the scenario:

  good       -- behaves like our stage 2 database
  badkey     -- rejects every key with PGRST301 (the bug we just hit)
  empty      -- events_public returns [] (seed not applied)
  leak       -- organizers_public leaks phone + email (a real regression)
  openrpc    -- anon may call is_admin() (the grant bug we just fixed)
  nomember   -- the editor account exists but belongs to no organizer
  dupuser    -- signup says "already registered" once, then works (the
                recover-by-recreating path in create-test-users.sh)
  dupforever -- signup always says "already registered" and the password
                never works (create-test-users.sh must give up loudly)
  selfpublish -- the editor CAN set status (the founding leak, unfixed)
"""
import json, os, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

MODE = os.environ.get("MODE", "good")
VALID_ANON = os.environ.get("VALID_ANON", "aaa.bbb.ccc")
EDITOR_JWT = "eee.ddd.iii"

DENIED = {"code": "42501", "details": None, "hint": None,
          "message": "permission denied for table"}
JWT_ERR = {"code": "PGRST301", "details": None, "hint": None,
           "message": "Expected 3 parts in JWT; got 4"}

EVENTS_PUBLIC = [{"id": "e-a", "slug": "2026-09-10-milonga-de-la-casita",
                  "title": "Milonga de la Casita", "type": "milonga",
                  "starts_at": "2026-09-10T21:00:00+02:00", "city": "Nice",
                  "cancelled_at": None, "cancellation_note": None}]
ORGS_PUBLIC = [{"id": "0a", "name": "Nissartango", "slug": "nissartango",
                "instagram": "nissartango", "website": "https://nissartango.fr"}]
ORGS_LEAKY = [dict(ORGS_PUBLIC[0], email="contact@nissartango.fr",
                   phone="+33 6 12 34 56 78")]
EDITOR_EVENTS = [{"id": "e-a", "title": "Milonga de la Casita", "status": "approved",
                  "organizer_id": "0a"},
                 {"id": "e-b", "title": "Practica secrete", "status": "pending",
                  "organizer_id": "0a"}]


SIGNUP_ATTEMPTS = {}
GOOD_PASSWORDS = {"bob@example.org": "practica-2026",
                  "dave@example.org": "milonga-2026"}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def key(self):
        return (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()

    def handle_any(self, method):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        select = q.get("select", [""])[0]
        key = self.key()

        # GoTrue
        if u.path == "/auth/v1/signup":
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            email = body.get("email", "")
            SIGNUP_ATTEMPTS[email] = SIGNUP_ATTEMPTS.get(email, 0) + 1
            first = SIGNUP_ATTEMPTS[email] == 1
            if MODE == "dupforever" or (MODE == "dupuser" and first):
                return self.send(422, {
                    "code": "23505",
                    "message": 'duplicate key value violates unique constraint '
                               '"users_email_partial_key"'})
            return self.send(200, {"id": "u-" + email, "email": email})

        if u.path == "/auth/v1/token":
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if MODE == "badkey":
                return self.send(401, JWT_ERR)
            email = body.get("email", "")
            # In the dup scenarios the stored password is unknown until the
            # account has been recreated (i.e. after a second signup).
            recreated = SIGNUP_ATTEMPTS.get(email, 0) >= 2
            if MODE == "dupforever":
                return self.send(400, {"code": 400, "error_code": "invalid_credentials",
                                       "msg": "Invalid login credentials"})
            if MODE == "dupuser" and not recreated:
                return self.send(400, {"code": 400, "error_code": "invalid_credentials",
                                       "msg": "Invalid login credentials"})
            if body.get("password") == GOOD_PASSWORDS.get(email, "practica-2026"):
                return self.send(200, {"access_token": EDITOR_JWT, "token_type": "bearer"})
            return self.send(400, {"error": "invalid_grant",
                                   "error_description": "Invalid login credentials"})

        # The public storage endpoint takes no key at all.
        if u.path.startswith("/storage/v1/object/public/"):
            if os.environ.get("PUBLIC_BUCKET") == "1":
                return self.send(400, {"statusCode": "404", "error": "Object not found",
                                       "message": "Object not found"})
            return self.send(400, {"statusCode": "404", "error": "Bucket not found",
                                   "message": "Bucket not found"})

        if MODE == "badkey":
            return self.send(401, JWT_ERR)
        if key not in (VALID_ANON, EDITOR_JWT):
            return self.send(401, JWT_ERR)

        editor = key == EDITOR_JWT

        # Storage
        if u.path.startswith("/storage/v1/object/list/"):
            return self.send(200, [])
        if u.path.startswith("/storage/v1/object/"):
            return self.send(400, {"statusCode": "403", "error": "Unauthorized",
                                   "message": "new row violates row-level security policy"})

        # PostgREST
        if u.path == "/rest/v1/events_public":
            if method != "GET":
                return self.send(401, dict(DENIED, message="permission denied for view events_public"))
            return self.send(200, [] if MODE == "empty" else EVENTS_PUBLIC)

        if u.path == "/rest/v1/organizers_public":
            if method != "GET":
                return self.send(401, dict(DENIED, message="permission denied for view organizers_public"))
            if re.search(r"\b(phone|email)\b", select):
                return self.send(400, {"code": "42703", "message":
                                       "column organizers_public.phone does not exist"})
            return self.send(200, ORGS_LEAKY if MODE == "leak" else ORGS_PUBLIC)

        if u.path == "/rest/v1/events":
            if not editor:
                return self.send(401, dict(DENIED, message="permission denied for table events"))

            if method == "GET":
                if MODE == "nomember":
                    return self.send(200, [])
                if "id=eq." in u.query:
                    status = "approved" if MODE == "selfpublish" else "pending"
                    return self.send(200, [{"status": status}])
                return self.send(200, EDITOR_EVENTS)

            n = int(self.headers.get("Content-Length") or 0)
            raw = (self.rfile.read(n) or b"{}").decode()

            if method == "DELETE":
                return self.send(204, [])

            touches_privileged = any(k in raw for k in
                                     ('"status"', '"review_note"', '"needs_review"', '"slug"'))
            if touches_privileged and MODE != "selfpublish":
                return self.send(403, dict(DENIED,
                    message="permission denied for column status of relation events"))
            if touches_privileged and MODE == "selfpublish":
                return self.send(200, [{"id": "e-new", "status": "approved"}])

            if method == "POST":
                return self.send(201, [{"id": "e0000000-0000-0000-0000-0000000000ff",
                                        "title": "Preuve (brouillon)", "status": "pending"}])
            return self.send(200, [{"id": "e-new", "status": "pending"}])

        if u.path == "/rest/v1/organizers":
            if editor and method == "GET":
                if MODE == "nomember":
                    return self.send(200, [])
                return self.send(200, [{"name": "Nissartango", "phone": "+33 6 12 34 56 78"}])
            return self.send(401, dict(DENIED, message="permission denied for table organizers"))

        if u.path in ("/rest/v1/organizer_members", "/rest/v1/user_roles"):
            return self.send(401, dict(DENIED, message="permission denied for table"))

        if u.path.startswith("/rest/v1/rpc/"):
            fn = u.path.rsplit("/", 1)[-1]
            if fn == "is_admin":
                if MODE == "openrpc":
                    return self.send(200, False)
                return self.send(404, {"code": "PGRST202", "message": "function not found"})
            if editor:
                return self.send(403, {"code": "42501", "message": "not authorised"})
            return self.send(401, {"code": "42501", "message": "permission denied for function"})

        return self.send(404, {"code": "PGRST205", "message": "not found"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PATCH(self):
        self.handle_any("PATCH")

    def do_DELETE(self):
        self.handle_any("DELETE")


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "54399"))), H).serve_forever()
