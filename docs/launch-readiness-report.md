# Shaunek Weather launch-readiness report

Date: 2026-11-01

## Executive summary

The local frontend, Node API, PostgreSQL, and weather service are running and responding. Static checks and all nine weather-service unit tests pass. Live browser searches for London and Tokyo showed different local dates and times, with each clock advancing by seconds. The homepage dashboard's “View more locations” control was verified live: eight initial cards expanded to 32 distinct cards over three clicks, with the control remaining available. The curated list contains 55 distinct cities and keeps a search shortcut after the list is exhausted. This is a local smoke test, not production certification: account/admin mutation flows, SMTP, Docker, deployment, and physical-device behavior were not tested.

The fresh repository security review found no confirmed vulnerabilities in the reviewed source and worktree. A local scan found no hard-coded credential values; local environment files are Git-ignored, and their values were not inspected. This review does not certify production hosting, transport security, runtime secrets, or the weather-service network boundary.

## Review scope

- Frontend pages, shared browser modules, page assets and styling.
- Express API, authentication/session flows, admin and account endpoints, and PostgreSQL schema.
- FastAPI weather service, provider request/normalization code and cache tests.
- Docker and Vercel deployment configuration, operations documentation, and CI checks.
- Repository-only security review. No production hosting, database, mail provider, or provider credentials were accessed.

## Changes and observations

- Added `frontend/favicon.jpeg` to the `<head>` of each of the nine HTML pages using a JPEG favicon link.
- Expanded the deployment guide with a step-by-step release and live/physical-device test runbook.
- Corrected the Render weather-service instructions to use the container's existing `0.0.0.0:8001` bind and private service networking; a loopback-only process cannot be reached by a separate service.
- Fixed the admin bootstrap vulnerability with an explicit `is_admin` database role, a partial unique index allowing only one admin, a rate-limited CSRF-protected bootstrap endpoint guarded by a private token, and checks that require both the role and configured email for admin access. The endpoint updates any pre-existing account at the configured admin email and replaces its password; remove the bootstrap token after provisioning.
- Updated the admin instructions and deployment guide to use the private bootstrap flow.
- The Vercel rewrite config still contains `REPLACE_WITH_RENDER_API_HOST`; production API, robots, and sitemap rewrites will not work until this is replaced with the actual Render API hostname.
- The README now creates local `.env` files only when absent, avoiding accidental replacement of existing credentials.
- Optimized the favicon to 256×256 (11,030 bytes) and brand logo to 720×192 (25,001 bytes), preserving their appearance while reducing combined asset size from 1,278,864 bytes to 36,031 bytes.
- Added an authenticated account overview with saved name, email, country, region, time zone, account creation date, and pending email-change status. Its bottom “Edit my details” action leads to settings.
- Signup now requires country and time zone, offers an optional region/state/province, and defaults the time zone to the browser's IANA time zone. The API persists and validates these values, and startup/database initialization adds backward-compatible columns for existing users.
- Updated account navigation and settings so profile location fields can be reviewed and edited. The end-to-end smoke script now covers signup location, account read, and profile update; it was syntax-checked but not run against a database because a disposable isolated database was not available.
- Search results now include a validated provider IANA time zone and a local clock showing hours, minutes, seconds, and date. The clock stops when a new search starts, and stale responses cannot replace the most recent search. If the running service does not yet return an IANA zone, the frontend uses the provider's location-local date/hour/minute and advances seconds; this fallback is minute-resolution until the updated weather service is restarted or redeployed.
- The home weather dashboard initially loads eight featured cities and adds eight different cities per click, through a 55-city curated list. The button stays available across pages and becomes a shortcut to search any city after the list is exhausted. The weather service paginates results and refreshes only the requested cities; tests confirm consecutive pages do not overlap.
- The search endpoint, UI and tests now consistently use a three-day forecast, matching the target provider plan; provider-response fixtures cover the current-conditions endpoint.
- The weather-service unit suite verifies location time zones, multi-page featured-city pagination and caching, and rejects invalid provider time zones. All nine tests pass.
- The app has request/response weather retrieval and a featured-weather cache, not a push/WebSocket real-time feed. "Live" testing means querying the configured provider and checking the freshness/cache behavior.

## Validation results

| Check | Result |
| --- | --- |
| `python3 scripts/check_project.py` | Passed: all HTML pages, local Markdown links and Vercel rewrite structure validated. |
| JavaScript syntax checks (`node --check backend/src/server.js` and all `frontend/*.js`) | Passed. |
| `python3 -m compileall -q weather-service/app weather-service/tests` | Passed. |
| `bash -n test-e2e.sh` | Passed. |
| `bash -n scripts/test-admin-bootstrap.sh` | Passed. |
| `git diff --check` | Passed. |
| Project secret scan | Passed: scanned tracked and untracked non-ignored source/configuration paths; no hard-coded credential values found. Local `.env` files are ignored by Git; tracked environment examples contain blank values/placeholders. |
| `cd weather-service && .venv/bin/python -m unittest discover -s tests -v` | Passed: all 9 weather-service tests, including three-page non-overlapping featured-city pagination and searched-location time-zone handling. |
| Fresh local HTTP route sweep (`/api/health`, `/api/auth/me`, featured/search weather, signup/account/admin pages, favicon, robots, sitemap) | Passed: all returned HTTP 200. |
| `GET /api/admin/users` without an authenticated session | Passed: returned HTTP 401. |
| Backend dependency tree (`npm ls --prefix backend --depth=0`) | Passed: installed top-level dependencies match the backend manifest. |
| ISO country selector comparison with local ISO 3166-1 data | Passed: all 249 country codes present, no extras; 419 time-zone choices generated and browser default detected. |
| Browser signup page and account access | Passed: signup page rendered country, optional region, and time-zone controls; browser time zone selected by default. Unauthenticated `/account.html` redirected to login. |
| `npm audit --prefix backend --omit=dev` | Passed: 0 known vulnerabilities in backend production dependencies. |
| Local frontend, account pages, admin page, favicon, API health, robots, and sitemap | Passed: all checked routes returned HTTP 200; optimized favicon content type is `image/jpeg` (11,030 bytes); all 9 HTML pages reference it. |
| `GET /api/auth/me` without a session | Passed: returned an unauthenticated state and `isAdmin: false`. |
| `GET /api/weather?city=London` through the Node API | Passed: HTTP 200 with `place`, `current`, `hourly`, and `daily`; 24 hourly and 7 daily entries. The already-running weather-service process still omits `timezone` but returns the provider's correct location-local time; restart/redeploy it to expose the new IANA time-zone field. |
| PostgreSQL and weather-service health | Passed: PostgreSQL accepted connections and weather `/health` returned `{"status":"ok"}`. |
| Browser weather-clock check | Passed against live local API searches: London and Tokyo showed distinct local dates/times (~9 hours apart across midnight), and each `HH:MM:SS` clock advanced. The running service used the documented provider-local-time fallback because its response had no IANA `timezone`. |
| Browser admin-page access | `/admin.html` rendered, then redirected an unauthenticated browser to `/login.html`. No admin credentials were used. |
| Featured “View more locations” browser interaction | Passed: three consecutive clicks expanded 8 locations to 32 distinct cards while keeping the button visible. A separate attempt to continue browsing hit the local API's 60-request rate limit, so the final-page search shortcut was not verified in the live browser. Three-page non-overlapping service pagination is covered by unit tests. |
| Backend/admin-bootstrap integration test | Not run: it creates accounts and consumes the one-admin slot; no disposable isolated database was established for that test. |
| Docker Compose validation/runtime | Not run: Docker CLI is not installed here. |
| SMTP, staging deployment, production configuration, and physical-device tests | Not run: those external services/devices were not available. |

The local API/database/weather request path was exercised, but registration, profile mutations, saved-place mutations, admin bootstrap, and email flows were not run end-to-end.

## Security review

The read-only repository review found no confirmed vulnerabilities in the source and worktree reviewed on 2026-11-01. The local credential-pattern scan covered tracked and untracked non-ignored project paths and found no hard-coded credential values. The tracked `.env.example` files contain blank values; local `.env` files are ignored by Git.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| — | — | — | — | No confirmed exploitable vulnerabilities found in this review. | — |

The existing admin controls use an explicit database role, a unique partial index, and a rate-limited, CSRF-protected bootstrap flow. Public registration does not assign the admin role. Provision the administrator only through the documented operator flow, and remove its temporary token after successful setup.

Positive controls observed include Argon2id password hashing, HttpOnly sessions, production secure-cookie checks, session regeneration on login/registration, CSRF checks on state-changing actions, rate limits, parameterized SQL, user-scoped saved places, and blocking that revokes sessions and checks blocked status on authenticated routes. The weather service has no caller authentication and therefore must remain on a private network.

**Review limitations:** the reviewer did not inspect ignored local environment-file values, production hosting settings, TLS termination, live runtime secrets, or deployed network access. The security review is not a production security certification. Keep provider and database credentials in the hosting secret manager, verify the weather service is private after deployment, and rotate any credential that may have been exposed.

## Step-by-step local test setup

Use a disposable local database and test accounts. Keep credentials in local environment files; never use production users for the smoke test.

1. Install Node.js 22+, Python 3.11+, PostgreSQL 15+, and the dependencies listed in `backend/package.json` and `weather-service/requirements.txt`.
2. Create `backend/.env` from `backend/.env.example` only if it does not already exist. Set a local PostgreSQL `DATABASE_URL`, a unique local `SESSION_SECRET`, `WEATHER_SERVICE_URL=http://127.0.0.1:8001`, and local frontend origins. Keep any existing `.env` file rather than overwriting it.
3. Create `weather-service/.env` from its example only if absent, add a valid `WEATHERAPI_KEY` there, and do not copy this key into frontend configuration or the Node API.
4. Initialize/update the local database from the repository root:

   ```sh
   set -a
   . backend/.env
   set +a
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/init.sql
   ```

5. In a terminal, start the private weather service:

   ```sh
   cd weather-service
   . .venv/bin/activate
   set -a
   . .env
   set +a
   uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```

6. In another terminal, start the API, which also serves the frontend:

   ```sh
   cd backend
   npm ci
   npm run dev
   ```

   If a static preview server is already using port 8080, stop that specific preview process first. Then open `http://localhost:8080`.
7. Check `http://localhost:8080/api/health`, `http://localhost:8080/favicon.jpeg`, and search for a few cities. The weather service's local health endpoint is `http://127.0.0.1:8001/health`.
8. With a disposable database, run the API smoke script from the repository root after setting a disposable test password:

   ```sh
   E2E_TEST_PASSWORD='a-unique-local-test-password' ./test-e2e.sh
   ```

   It creates a user and saved location. Do not run it against production.

## Live and physical-device test guide

Run these checks against staging with disposable accounts and test mailboxes:

1. Record the frontend/API release identifier and browser/device versions. Check API health and deployment logs.
2. Confirm the weather API key is configured only in the private weather service. Load featured cities, search cities in multiple regions, inspect current/hourly/three-day conditions, wait past the 10-minute featured cache interval, and verify refreshed readings. Try an invalid city and an upstream outage in staging; confirm useful errors and that eligible cached results are labeled.
3. On the home weather dashboard, confirm eight locations appear initially. Click “View more locations” repeatedly and verify each batch adds different locations, with the button remaining available through the curated list. After it is exhausted, verify “Search another city” focuses the search field; confirm each card still opens its forecast.
4. Exercise registration, login, logout, save/delete places, settings, password update, forgot/reset password and email verification. Verify one account cannot read another account's saved locations; test expired and reused email tokens when practical.
5. Configure `ADMIN_EMAIL` and a temporary, random `ADMIN_BOOTSTRAP_TOKEN` in staging. Provision the sole admin using `POST /api/admin/bootstrap`, then remove the token and redeploy. Verify an email match without the database admin role is not treated as an admin. Block a disposable user while it has a second active session, verify login and authenticated requests are denied, unblock it and verify access returns, and confirm the admin cannot block itself.
6. On a physical iPhone/iPad with Safari and Android phone/tablet with Chrome, test portrait/landscape, real touch targets, keyboard behavior, form labels/errors, favicon/logo, search, forecast panels, saved places, and settings. Also test a desktop browser and at least one mobile network. Capture screenshots only with test data.
7. In browser developer tools, inspect failed requests and console errors, verify the production browser uses the Vercel same-origin API rewrites, check the icon returns successfully, and confirm no `WEATHERAPI_KEY` appears in page source, browser storage, or network requests. Confirm production cookies are Secure and HttpOnly.
8. Exercise failure recovery in staging: restart a service, simulate a provider outage, verify database backups can be restored, and inspect logs for unexpected 5xx responses. Document pass/fail and defects before promoting.

## Step-by-step deployment guide

1. **Prepare the release.** Run the checks above and require CI to pass. Use separate staging and production services/data.
2. **Provision PostgreSQL.** Create the database, back it up before schema changes, and run `backend/db/init.sql` from a trusted host. For existing production databases, use a planned maintenance window and verify a restore path.
3. **Deploy the weather service privately.** Use the `weather-service` directory and its Dockerfile. Configure `WEATHERAPI_KEY` as a secret in that service only. Its container listens on `0.0.0.0:8001`; keep it private and use the private service URL from the API.
4. **Deploy the Node API.** Configure the Node service from repository root with install command `npm ci --prefix backend`, start command `node backend/src/server.js`, and health check `/api/health`. Configure `DATABASE_URL`, `WEATHER_SERVICE_URL`, `SESSION_SECRET` (at least 32 random characters), `NODE_ENV=production`, `PORT=8080`, `FRONTEND_ORIGIN`, `PUBLIC_APP_URL`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=lax`. Configure SMTP secrets only if password reset/email change must be enabled.
5. **Deploy the static frontend.** In `frontend/vercel.json`, replace every `REPLACE_WITH_RENDER_API_HOST` with the actual API service hostname. Set the Vercel root directory to `frontend`, use the static/Other preset, and leave the build command empty. Deploy to a staging URL first.
6. **Align origins and proxy.** Set `FRONTEND_ORIGIN` and `PUBLIC_APP_URL` to the exact HTTPS Vercel domain (origin only), then redeploy the API. Confirm `/api/health` and weather API requests work through the Vercel domain, plus `/robots.txt` and `/sitemap.xml`.
7. **Enable optional services safely.** Set up SMTP and verify delivery. Set the intended `ADMIN_EMAIL` and a fresh `ADMIN_BOOTSTRAP_TOKEN` in the backend secret manager, provision one admin through the protected endpoint, then remove the token and redeploy. Verify an email match without `is_admin` is not treated as an admin.
8. **Run the live/physical checklist**, review errors and backup status, and only then promote to production. Keep the weather service private, enable platform dependency/security alerts and branch protection, and monitor API/provider/email failures after release.

## Remaining release gaps

- Run admin bootstrap and non-admin access denial tests on an isolated staging database before production.
- Replace the Render hostname placeholder in `frontend/vercel.json`.
- Run full account/admin browser and API integration tests against disposable staging services.
- Test SMTP and physical devices; neither was available during this review.
- Docker-based local validation was unavailable because Docker is not installed.
- Configure production backup/restore drills, monitoring, dependency alerts, and branch protection; these require hosting/repository settings.
