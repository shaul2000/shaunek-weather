# Shaunek Weather: what this release should do

The first release focuses on straightforward everyday weather checks rather than a full weather-station network. This document defines the current product scope and the capabilities intentionally deferred.

## What users can do

1. See current conditions for eight featured cities across Africa, Europe, North America, the Middle East, Asia and Australia on the home page. Browse further through a curated list of 55 locations in distinct batches without repeats. Readings are cached for ten minutes and can fall back to a recent cached result during a provider outage.
2. Search for a city anywhere in the world and view current conditions, an hourly forecast, and a three-day forecast. If a name matches multiple locations, use the provider's first result for now.
3. Register with a first name, last name, email and password; confirm the password before submitting.
4. Request a password-reset link by email, then set a new password with that one-time link.
5. Log in and log out using a server-side session.
6. Save a city to their account, revisit it later and remove it.
7. Update profile names, change their email after confirming the new address, and change their password after entering the current password.
8. Choose a light or dark theme, Celsius or Fahrenheit, and km/h or mph.
9. See a useful loading, validation or error message when a request cannot be completed.
10. Allow one deployment-designated administrator, identified by the fixed username `shauAdmin`, to view a paginated account list and block or unblock non-admin accounts.

## Product and technical expectations

- Pages work on mobile and desktop, use labeled form fields and announce request status accessibly.
- The public home page has a descriptive title and summary, social-sharing metadata, a canonical URL, structured application data, and a sitemap entry. Account and password-reset pages are excluded from indexing.
- Passwords are stored as Argon2id hashes, never as plaintext.
- Session cookies are HttpOnly. State-changing browser requests include a session-bound CSRF token.
- SQL uses parameters, and saved places are always read or changed within the signed-in user's account.
- Secrets are supplied through environment variables rather than frontend files or source code.
- The weather service reads `WEATHERAPI_KEY` from its own environment, uses bounded provider timeouts, and caches featured weather. The browser and Node API must never receive this key. Public weather routes are not rate-limited; select a provider plan for expected request volume and monitor usage. Provider outages should leave recent readings visible and report when cities could not be updated.
- Password-reset tokens are random, stored as hashes, expire after one hour, are single-use, and are delivered through configured SMTP.
- Password-reset responses do not disclose whether an email address belongs to an account.
- Email updates are pending until the new address is confirmed with a one-time, expiring link. Password changes end other active sessions.
- Display and weather-unit preferences are saved locally in the user's browser.
- Administrator access requires both the explicit `is_admin` database role and the configured `ADMIN_EMAIL` after normal sign-in. The role is provisioned only through the rate-limited, CSRF-protected bootstrap endpoint with the private `ADMIN_BOOTSTRAP_TOKEN`; a unique database index enforces one admin. Its username is fixed as `shauAdmin` and cannot be changed through the app. Registration cannot claim the configured address. Blocking prevents future logins, invalidates active sessions, and blocks authenticated account actions; the admin cannot block itself. The admin API never exposes password hashes, session contents, or account tokens; app services do not depend on an admin being logged in.
- WeatherAPI.com is credited beside weather data (not in the footer), and weather is not presented as an official emergency warning. The selected provider plan must cover the app's forecast horizon and expected request volume.

## Not included yet

Radar, personal weather stations, historical data, severe-weather notifications, social features and billing are outside the current release.

Password recovery requires working SMTP settings. Without them, the API reports that password reset email is not configured.
