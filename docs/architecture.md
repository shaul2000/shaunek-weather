# Shaunek Weather architecture

Shaunek Weather separates the browser, public API, and private weather service. PostgreSQL stores accounts and saved places; SMTP is used for account email.

```text
Browser
  └── Vercel static frontend and same-origin API rewrites
        └── Render Node.js / Express API
              ├── PostgreSQL (accounts, sessions, saved places, account tokens)
              ├── SMTP provider (password reset and email verification)
              └── Private Python / FastAPI weather service
                    └── WeatherAPI.com current and forecast APIs
```

Vercel hosts the static frontend and proxies `/api/*`, `/robots.txt`, and `/sitemap.xml` to Render. The browser therefore uses same-origin URLs and the session cookie does not depend on third-party-cookie support. The Node API manages login sessions, validates requests and enforces ownership of saved locations. Browser API requests with an `Origin` header must match the configured frontend origin; this also prevents Vercel preview origins from changing production accounts. The browser does not connect directly to PostgreSQL or to the Python service.

The weather service resolves cities worldwide, normalizes current conditions and forecasts, and reads `WEATHERAPI_KEY` only from its own environment. The browser and Node API never receive the provider key. Search results include the provider's validated IANA time zone; the browser renders the current local date and a live hours/minutes/seconds clock in that zone. The home weather dashboard initially shows eight featured cities. Its “View more locations” button remains available to page through the curated list of 55 distinct cities in batches of eight; after the list is exhausted, it stays as a shortcut to the city search. Each weather-service process caches featured readings for ten minutes and can show the last available reading for up to six hours if the provider is temporarily unavailable. The search forecast includes current conditions, an hourly view, and a three-day forecast. It should only be reachable by the Node service.

## Code map

- `frontend/index.html`, account recovery pages, `frontend/account.html`, `frontend/settings.html` and `frontend/verify-email.html` make up the browser UI.
- `frontend/api.js` owns shared fetch and CSRF helpers; `frontend/preferences.js` stores theme and unit choices in the browser.
- `frontend/app.js` handles the home-page weather and saved-place interactions.
- `frontend/auth.js` handles login, registration and password recovery.
- `frontend/account.js` renders the signed-in member's account overview; its edit action leads to settings.
- `frontend/location.js` fills the signup and profile country/time-zone selectors.
- `frontend/settings.js` handles account settings and email confirmation.
- `frontend/config.js` contains the optional public API base URL for a separately hosted frontend. With the Vercel rewrites, it remains empty. It must not contain secrets.
- `frontend/vercel.json` proxies API, robots, and sitemap requests to the Render API service; replace the documented hostname placeholder before deploying.
- `backend/src/server.js` defines the HTTP routes, sessions, validation and database access.
- `backend/db/init.sql` creates the database tables and adds the profile, location, and account-blocking columns used by the API.
- `weather-service/app/main.py` calls WeatherAPI.com, caches featured-city readings, translates provider errors, and returns normalized current, hourly, and daily forecast data.

The public home page includes descriptive search metadata and WebApplication structured data. Account and password-recovery pages are marked `noindex`; only the public home page is included in the sitemap.

## Session and request flow

The frontend requests a CSRF token before enabling account actions. It sends that token in the `X-CSRF-Token` header for state-changing requests. Express stores the session in PostgreSQL and sends the browser an HttpOnly cookie. Login and registration regenerate the session identifier.

Password recovery creates a random token and stores only its SHA-256 hash in PostgreSQL. The link is sent through configured SMTP, expires after one hour and can only be used once. Applying a valid link updates the password and invalidates the user's other reset tokens and active sessions.

Changing an email address requires the current password and sends a one-time confirmation link to the new address. The address changes only after confirmation; the token is stored as a hash and expires after one hour. Password changes also require the current password and end the user's other active sessions.

Theme and weather-unit preferences are stored locally in the browser and are not account-synchronized.

Weather lookups are public. Saved-place reads and writes require an authenticated session, and database queries include the current user's ID.

The home page credits WeatherAPI.com beside its weather data. The provider key belongs only in the private weather service's environment, never in the frontend or Vercel configuration.

The optional admin dashboard requires the `is_admin` database role and a signed-in account whose email matches the Node API's `ADMIN_EMAIL`. A partial unique index allows only one admin; registration and an email match alone never grant the role. Provision the account through the rate-limited, CSRF-protected `/api/admin/bootstrap` endpoint using the private `ADMIN_BOOTSTRAP_TOKEN`, then remove that token from the runtime environment. The fixed admin username is `shauAdmin`. The dashboard exposes paginated account names, email addresses, signup timestamps, and block status, and allows the admin to block or unblock non-admin users. Blocking prevents login and authenticated account actions and removes the account's active sessions. It does not expose password hashes, session records, or account tokens; the weather and account services run independently of admin login state.

## Deployment notes

Locally, the Node API, Python weather service, and PostgreSQL run as separate processes/services. In the recommended production setup, Vercel serves the static pages and reverse-proxies API requests to the Render API. Set `FRONTEND_ORIGIN` and `PUBLIC_APP_URL` to the exact Vercel production origin, and keep `COOKIE_SECURE=true` with `COOKIE_SAME_SITE=lax`. Do not bypass the Vercel proxy in the browser with a direct Render API URL; that would reintroduce cross-site cookie restrictions.

The deployment steps and current platform references are maintained in [docs/deployment.md](./deployment.md).
