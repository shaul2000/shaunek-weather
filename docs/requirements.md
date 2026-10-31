# Requirements (MVP)
## Functional
1. Visitors can search a city and view current conditions plus a seven-day forecast.
2. Visitors can register, log in and log out.
3. Authenticated users can save and remove locations.
4. The UI communicates loading, validation and service errors accessibly.

## Non-functional
- Responsive layout and accessible labels/status messages.
- Passwords hashed using Argon2id; passwords never stored in plaintext.
- Session cookies are HttpOnly; mutating requests require a session-bound CSRF token.
- SQL is parameterized; user-owned saved locations are scoped by authenticated user ID.
- Secrets are supplied through environment variables.
- External weather requests have timeouts and normalized errors.

## Out of scope for MVP
Radar, station observations, historical data archives, alert delivery, social features and billing.
