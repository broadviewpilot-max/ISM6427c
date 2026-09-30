# The Aimsir Foundation Operations Tool

A password-protected operations tool that replaces scattered spreadsheets with one system for **Participants**, **Mentors**, **Sponsors & Donors** and **Reporting**. *Grant Tracking* and *Event Management* are reserved as planned modules (navigation placeholders only).

The app ships with **no data**. Every record is one the Foundation enters. The default program stage names (Settings → Program stages) are neutral starting values, not Foundation facts; replace them with the Foundation's own.

## Stack and why

| Layer | Choice | Reason |
| --- | --- | --- |
| Front end | Plain HTML, CSS and JavaScript modules in `public/` | No build step, nothing to break, no framework to maintain. Netlify serves it as-is. |
| API | One Netlify Function (`netlify/functions/api.mjs`) | Serverless, free tier, deploys with the site. |
| Database | **Netlify Blobs** | Built into Netlify: no separate account, no connection string, no API key. Right size for a nonprofit's record volume. |
| Gate | One Netlify **Edge Function** (`netlify/edge-functions/gate.js`) | Runs before any page or file is served, so nothing is reachable without the password. |

Trade-off: Blobs is a key-value store, not SQL. Lists are loaded whole and filtered in the browser, which is comfortable for thousands of records. If the Foundation outgrows it, the storage code is isolated in `netlify/lib/store.mjs`.

## Authentication (single shared password)

1. Every request hits the Edge Function first. Without a valid session cookie, only the sign-in page and its assets are served; everything else redirects to `/login.html`, and API calls return `401`.
2. The password is **never in the code**. It lives in the `APP_PASSWORD` environment variable and is compared server-side using SHA-256 digests and a constant-time comparison.
3. A correct password sets a signed session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`) that lasts **7 days** (`SESSION_DAYS`, max 30). The API re-verifies the cookie on every call.
4. The cookie signature covers a fingerprint of the current password, so **changing `APP_PASSWORD` signs everyone out**.
5. Five wrong attempts from one address lock sign-in for 15 minutes. The app also signs out after 30 minutes of inactivity.
6. If the environment variables are missing or weak, the site **fails closed** (a 503 page, never open access).

### Changing the shared password (no rebuild, no code)

Netlify → **Site configuration → Environment variables** → edit `APP_PASSWORD` → **Deploys → Trigger deploy**. Share the new password with the board.

## Data protection (participants may be minors)

- **Encrypted at rest by the app**: every record is encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`) before it is stored, on top of Netlify's own encryption. Each ciphertext is bound to its record key.
- **Minimal data**: no SSN, government ID, financial account or medical fields exist. The Notes fields warn against entering them.
- **Minors**: participants under 18 are flagged automatically. A parent/guardian is required to save the record, guardian contact details are shown in lists instead of the minor's, and consent-on-file is tracked and surfaced on the dashboard.
- **Input safety**: the server stores only whitelisted, validated fields; the front end builds pages with `textContent` only (no HTML injection); CSV exports neutralise spreadsheet formulas.
- **Request safety**: same-origin and custom-header checks on every write, strict Content-Security-Policy, HSTS, `no-store` caching, `noindex`, no third-party scripts, fonts or trackers.
- **Audit trail**: sign-ins, failed sign-ins, creates/updates/deletes, exports and backups are logged by record ID only (never names). Visible under Settings.
- **Exports**: the summary CSV has no personal details. Detailed exports require a confirmation and are logged.
- **Keep the key**: `DATA_ENCRYPTION_KEY` must never be changed or lost, or existing records cannot be read. Store a copy in the Foundation's password manager. Settings → Download backup gives a plain JSON copy; store it securely.

## Free, keyless public APIs

No account, key or payment. Both are optional conveniences that fail silently. Only a ZIP code or a year is ever sent, never a person's data.

- [Zippopotam.us](https://zippopotam.us): fills city and state from a US ZIP code.
- [Nager.Date](https://date.nager.at): warns when a follow-up, renewal or enrollment date lands on a US public holiday or weekend.

These were selected from their public documentation. They could not be exercised from the build environment, so confirm the ZIP and date hints work after the first deploy. The CSP permits only these two hosts.

## Deploy to Netlify

1. Netlify → **Add new site → Import an existing project → GitHub** → this repository, branch `main`. Build command: *(none)*. Publish directory: `public` (already set in `netlify.toml`).
2. **Before the first deploy**, add environment variables (Site configuration → Environment variables):

   | Variable | Value |
   | --- | --- |
   | `APP_PASSWORD` | The shared board password (at least 8 characters; a long passphrase is better) |
   | `SESSION_SECRET` | Random string, 32+ characters. Generate with `openssl rand -base64 32` |
   | `DATA_ENCRYPTION_KEY` | Exactly 32 random bytes, base64. Generate with `openssl rand -base64 32`. Never change it. |
   | `SESSION_DAYS` | Optional, default `7` |

3. Deploy, open the site URL, sign in.

## Run locally

```sh
npm install
npm run dev        # http://localhost:8888, dev password: local-dev-password
npm test           # API, auth and encryption tests
```

Local records are stored (still encrypted) in `.data/`, which is git-ignored. Set `APP_PASSWORD`, `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` in the shell to override the development defaults.

## Design

Default light theme uses the Bahamian flag palette (aquamarine, gold, black); a Dark toggle in the header is remembered per browser. Layout adapts from desktop to tablet to phone (tables become cards, navigation becomes a drawer). Reports print cleanly to PDF. The logo mark is a simple placeholder in `public/favicon.svg`; replace it with the Foundation's official artwork.

## Repository layout

```
public/                 front end (served only after sign-in, except login assets)
netlify/edge-functions/ password gate
netlify/functions/      API entry point
netlify/lib/            auth, encryption, validation, storage, API logic
scripts/dev-server.mjs  local development server
test/                   automated tests
archive/boca-weather/   earlier, unrelated app kept for reference (not deployed)
```
