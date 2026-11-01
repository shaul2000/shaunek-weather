# Security notes for Shaunek Weather

This document records the application's security controls and remaining operational risks. It is an engineering checklist, not a security certification; live hosting configuration and runtime secrets must be reviewed separately.

| What matters | What could go wrong | Current controls |
|---|---|---|
| Account passwords | A database leak exposes reusable passwords | Argon2id hashes; passwords are not returned by the API |
| Login sessions | A stolen or fixed session gives access to an account | HttpOnly session cookie, session regeneration on login and registration, eight-hour expiry; production requires Secure cookies |
| State-changing requests | A malicious site submits actions using a signed-in browser | Random session-bound CSRF token required in a custom request header |
| Password reset | A guessed, leaked or replayed link changes an account password | 256-bit random token, hash-only database storage, one-hour expiry, single use, rate limiting, and active-session invalidation |
| Account email | An attacker redirects account messages to an address they control | Require the current password to request a change; apply it only after a one-time link is confirmed at the new address |
| Password changes | A compromised password remains usable in other sessions | Require the current password, hash the replacement with Argon2id, and end other sessions and outstanding reset tokens |
| Account discovery | Reset requests reveal which email addresses have accounts | Same accepted response for existing and unknown accounts |
| Saved locations | A user reads or deletes someone else's place | Queries scope reads, inserts and deletes to the authenticated user ID |
| Database contents | Crafted values alter a query | Parameterized SQL and schema validation |
| API capacity | Repeated login attempts or large bodies exhaust resources | Authentication rate limit, JSON body-size limit and timeouts for weather calls |
| Runtime secrets | A repository or frontend leak exposes credentials | Environment-based configuration, ignored environment files and public-only frontend config; production startup checks require HTTPS origins, a long session secret and Secure cookies |
| Admin bootstrap | An attacker registers the email intended for the administrator before `ADMIN_EMAIL` is configured | Registration alone does not grant administrator access. The admin role is provisioned through a rate-limited, CSRF-protected endpoint requiring the private `ADMIN_BOOTSTRAP_TOKEN`; a partial unique index limits the role to one account. Remove the token after bootstrap. |
| Account blocking | A blocked user retains an active session or can still mutate account data | Admin-only block/unblock routes; blocking deletes stored sessions, rejects future logins, and guarded account endpoints re-check current blocked status |
| Weather provider key and quota | A leaked provider key is abused or provider quota is exhausted | Keep `WEATHERAPI_KEY` only in the private weather service's environment, never expose it to browser code, and cache featured-city requests. Public weather routes are not rate-limited, so provider-plan capacity and usage monitoring are required; consider shared caching or service-side quotas before scaling. |
| Weather-service access | An outside caller uses the service or consumes its provider quota | The service is intended to be private; it currently has no caller authentication, so network isolation matters |
| Email credentials | SMTP access is misused or intercepted while sending reset links | Credentials are configured on the backend; STARTTLS or implicit TLS is required; use a limited sending account and rotate credentials if exposed |

## Remaining work before a public launch

- Add automated tests for login, registration, CSRF enforcement and saved-place ownership.
- Test SMTP delivery, expired and reused reset tokens, and password reset session invalidation.
- Keep the weather service on a private network or add service-to-service authentication if that is not possible.
- Add dependency and secret scanning, monitoring, database backup/restore drills and an independent security review.
- Confirm HTTPS, cookie settings, proxy trust and the exact allowed frontend origin in the production environment.
- Review WeatherAPI.com plan limits and terms, and make sure users understand that the app is not an emergency-alert service.
