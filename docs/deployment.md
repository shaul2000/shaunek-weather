# Testing and deploying Shaunek Weather

This guide covers a local setup and a Render API/database plus Vercel frontend deployment. Keep credentials in ignored local environment files or the hosting provider's secret manager. Do not put credentials in frontend files or public documentation.

## WeatherAPI.com key

Create a WeatherAPI.com account and copy the key from its account dashboard. Set it only as `WEATHERAPI_KEY` in `weather-service/.env` locally and in the weather service's private runtime environment when deployed. The key is read by the Python weather service; neither the frontend nor the Node API needs it. If exposed, revoke it with the provider and replace it.

The dashboard initially requests current conditions for eight featured cities and can load further pages from a curated list of 55 locations. The weather service refreshes only the requested page, and featured results are cached for ten minutes per service process. City searches include a three-day forecast. Check the provider's [current plans and limits](https://www.weatherapi.com/pricing.aspx) for request volume and current terms before launch.

## Test locally

Install Node.js 22+, Python 3.11+, PostgreSQL 15+, and the Python requirements. Create a local database and `backend/.env` from `backend/.env.example` only if the file does not already exist. Set a database URL and a unique session secret; keep the file local and do not overwrite existing credentials.

Initialize the database from the repository root:

```sh
set -a
. backend/.env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/init.sql
```

For an existing deployment, back up PostgreSQL and rerun this idempotent script before deploying schema changes; it adds the profile/location and account-blocking columns, token tables, and single-admin index.

In the weather-service terminal, create its local environment file, add the provider key, load it, and start the service using the project's configured command:

```sh
cd weather-service
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
if [ ! -e .env ]; then cp .env.example .env; fi
# Add WEATHERAPI_KEY to .env before loading it.
set -a
. .env
set +a
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

In a second terminal, start the Node API:

```sh
cd backend
if [ ! -e .env ]; then cp .env.example .env; fi
# Set DATABASE_URL and a unique SESSION_SECRET in .env.
# For admin bootstrap tests, set ADMIN_EMAIL and a unique ADMIN_BOOTSTRAP_TOKEN too.
npm ci
npm run dev
```

Open `http://localhost:8080`. Verify the Python weather-service contract directly:

```sh
curl -fsS "http://127.0.0.1:8001/weather?city=London"
curl -fsS "http://127.0.0.1:8001/featured"
```

Check that `/weather` has `place`, `current`, `hourly`, and `daily`; numeric measurements must be JSON numbers, the hourly arrays contain at most 24 entries, and all parallel arrays have matching lengths. `/featured` should return eight `{ place, current, stale }` entries. Then exercise the browser: search cities in multiple countries, check temperature and wind preferences, try a mobile viewport, and—using a disposable local account—test registration, login/logout, saved places, settings, and email flows if SMTP is configured.

To run the manual API smoke script, use only a disposable local database and account. It creates a user and saved location; never use it against production data. Automated weather-service unit tests use mocked provider responses and do not call the network:

```sh
PYTHONPATH=weather-service python3 -m unittest discover -s weather-service/tests -v
```

On an empty, disposable database, `scripts/test-admin-bootstrap.sh` exercises first-admin provisioning, sign-in, rejection of a repeated bootstrap, and prevention of admin self-blocking. Load the backend environment and set a unique admin test password before running it:

```sh
set -a
. backend/.env
set +a
E2E_ADMIN_PASSWORD='a-unique-local-admin-password' bash scripts/test-admin-bootstrap.sh
```

It provisions the configured admin and consumes the database's one-admin slot. Do not run it against production or an existing admin account. Remove `ADMIN_BOOTSTRAP_TOKEN` from the backend environment after successful provisioning.

## Deploy the backend to Render

1. Create Render Postgres and keep its connection URL private. Before the API's first start, apply `backend/db/init.sql` using a trusted machine and the database's secure external connection. For existing databases, back them up and rerun the idempotent script when applying schema updates. Configure the API with the database's internal URL when services share a region.
2. Create the Python weather service as a private service in the same region and select Render's Docker runtime. Set its root directory to `weather-service`; Render will build from `weather-service/Dockerfile`, which installs the requirements and starts Uvicorn. Set `WEATHERAPI_KEY` in this service's runtime environment only.
3. Keep the weather service private on the same region/network as the API. Its container listens on `0.0.0.0:8001` (as set by `weather-service/Dockerfile`); do not override the command with a loopback-only bind. Set `WEATHER_SERVICE_URL` on the Node API to the weather service's private URL, including port `8001`. Do not expose the weather service publicly.
4. Create the Node API as a Node service with repository root `.`. Install with `npm ci --prefix backend`; start with `node backend/src/server.js`. Set the health check to `/api/health`.
5. Configure these API environment variables in Render:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `PORT` | `8080` |
   | `DATABASE_URL` | Render Postgres internal URL |
   | `SESSION_SECRET` | New random value, at least 32 characters |
   | `ADMIN_EMAIL` | The single administrator email to provision; it does not grant admin access by itself |
   | `ADMIN_BOOTSTRAP_TOKEN` | One-time private random secret, at least 32 characters; remove after provisioning |
   | `WEATHER_SERVICE_URL` | Private weather service URL |
   | `FRONTEND_ORIGIN` | Exact Vercel production origin |
   | `PUBLIC_APP_URL` | Same public Vercel origin |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_SAME_SITE` | `lax` |
   | `PGSSL` | `false` for Render's internal Postgres URL, if required |

   Do not include paths in the two origin variables. Generate a session secret locally and enter it directly in Render's environment settings:

   ```sh
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

   To provision the sole admin, set `ADMIN_EMAIL` to the intended account email and set a random `ADMIN_BOOTSTRAP_TOKEN` (at least 32 characters) in the API's private environment. Public registration of this address is rejected while configured, and the explicit `is_admin` database role is never inferred from email alone.

   Send `POST /api/admin/bootstrap` over HTTPS with the CSRF header, the configured email, first/last name, a strong password, and `setupToken` equal to the private token. The endpoint is rate-limited and refuses to run after an admin already exists. It can reset and replace any pre-existing account at that same configured address, so only an authorized deployer should use it.

   After a successful response, remove `ADMIN_BOOTSTRAP_TOKEN` from the backend environment and redeploy. The admin signs in normally and opens `/admin.html`; its fixed username is `shauAdmin`. The dashboard lists account names, emails, signup times, and status; the admin can block or unblock non-admin accounts. Blocking prevents sign-in, ends active sessions, and restricts authenticated requests.

6. To enable password recovery and email changes, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` on the Node API. Without SMTP, those email workflows cannot complete.
7. Inspect service logs and verify `/api/health`, `/api/weather/featured`, and `/api/weather?city=London` after the weather service is reachable. These checks require the production provider key and valid provider plan.

## Deploy the frontend to Vercel

1. In `frontend/vercel.json`, replace `REPLACE_WITH_RENDER_API_HOST` with the API service hostname only, without `https://` or a path.
2. Connect the repository to Vercel, set the project root directory to `frontend`, select the Other framework preset, and leave the build command empty for the static site.
3. Deploy the production branch. Set the Render API's `FRONTEND_ORIGIN` and `PUBLIC_APP_URL` to the exact Vercel HTTPS origin, then redeploy the API if those values changed.
4. Verify `/api/health`, `/api/weather/featured`, `/api/weather?city=London`, `/robots.txt`, and `/sitemap.xml` through the Vercel domain.
5. Use a separate staging backend and database for preview deployments; production rejects requests from unconfigured origins.

## Production checks

- Confirm the initial eight featured cities load, “View more locations” can load distinct subsequent pages, and recent cached readings are identified when stale.
- Search locations in different countries; check current, hourly, and three-day output.
- Test registration with country, region, and time zone; verify the account overview, bottom edit action, profile updates, sign-in/out, saved locations, preferences, and account settings with disposable data.
- If SMTP is configured, test password reset and email verification with a test mailbox.
- Check mobile layout, browser console/network errors, secure cookies, and same-origin API requests.
- Review provider plan/terms, set up backups and restore drills, and enable repository branch protection and dependency/security alerts.
- Treat weather output as informational; it is not an official alert or emergency service.

## Live and physical-device test runbook

Use staging services, a staging database, and disposable test accounts. Do not test blocking, registration, reset links, or schema changes against real users or production data.

1. **Check the release and services.** Confirm CI is green and the frontend, Node API, PostgreSQL, and private weather service are running. Check `/api/health` through the public frontend origin. Check that the weather service is reachable only from the Node API's private network.
2. **Check real provider data.** With a valid `WEATHERAPI_KEY` configured only on the weather service, open the home page and confirm the featured-city cards load. Search a few distinct cities, verify current/hourly/three-day data, and refresh after ten minutes to exercise the featured cache. Try a deliberately invalid city and verify a clear error without exposing provider credentials.
3. **Check account journeys.** Use a disposable mailbox/account to register, sign out, sign in, save a location, revisit and remove it, change profile details, and change password. Confirm a second account cannot see the first account's saved places. If SMTP is configured, exercise reset and email-confirmation links, including an expired/reused link.
4. **Check admin enforcement.** Use the trusted bootstrap endpoint with the private token to provision the sole admin. Remove the token and redeploy. Confirm that account sees the admin dashboard and fixed `shauAdmin` identity while a normal account gets no admin access. With two disposable non-admin sessions, block one account: verify it cannot sign in or make authenticated requests and its previous sessions no longer work; then unblock it and verify access is restored. Confirm the admin cannot block itself.
5. **Check responsive and physical devices.** Test current Safari on a physical iPhone/iPad and Chrome on a physical Android device, plus a desktop browser. Verify portrait and landscape layouts, keyboard and screen-reader labels, form errors, logo/favicon, search, forecast scrolling, account navigation, and saved places. Repeat on a mobile network if practical. For local LAN testing, use a trusted network and configure the API's allowed `FRONTEND_ORIGIN` to the exact LAN URL; never expose a development API or real credentials on a public network.
6. **Check deployed browser behavior.** In browser developer tools, confirm page assets and `favicon.jpeg` return successfully, API calls use the intended same-origin Vercel proxy, no browser request contains `WEATHERAPI_KEY`, and production session cookies are Secure and HttpOnly. Verify `/robots.txt`, `/sitemap.xml`, and the account pages' `noindex` behavior.
7. **Check failure and recovery.** In staging only, temporarily make the weather provider unavailable and confirm a useful error or recent cached featured data is shown. Review API/weather logs for unexpected 5xx responses, restore the provider, and verify PostgreSQL backups can be restored before promoting the release.

These are manual acceptance checks, not a substitute for automated API/database and browser integration tests. Record device/browser versions, build/release identifier, test-account identifiers (never passwords), results, and any defects in the release checklist.
