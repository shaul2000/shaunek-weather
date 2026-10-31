# Shaunek Weather

A security-conscious full-stack weather application starter.

## Architecture
- `frontend/`: HTML, CSS and browser JavaScript.
- `backend/`: Node.js + Express API, PostgreSQL persistence, Argon2id password hashing and server-side sessions.
- `weather-service/`: Python + FastAPI service that queries Open-Meteo.
- `docs/`: requirements, architecture, threat model and deployment notes.

The browser talks only to the Node API. Node calls the private Python weather service. The Python service is not intended to be exposed publicly.

## Requirements
- Node.js 22 LTS or newer supported LTS, npm
- Python 3.11+
- PostgreSQL 15+
- Git

## Local setup (recommended: Docker Compose)
1. Copy `.env.example` to `.env` in the project root and replace `SESSION_SECRET` with a long random value.
2. Run `docker compose up --build`.
3. Open http://localhost:8080.

Create a strong random session secret with:
`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`

The compose file starts PostgreSQL, the Python service and Node API. The frontend is served by the Node API, keeping local requests same-origin.

## Local setup without Docker
1. Start PostgreSQL and create a database/user matching `backend/.env.example`.
2. In `weather-service/`: create a virtual environment, install `requirements.txt`, then run `uvicorn app.main:app --host 127.0.0.1 --port 8001`.
3. In `backend/`: copy `.env.example` to `.env`, run `npm install`, then `npm run dev`.
4. Open http://localhost:8080.

## API overview
- `GET /api/health`
- `GET /api/csrf`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/weather?city=Abuja`
- `GET /api/locations`
- `POST /api/locations` `{ "city": "Abuja" }`
- `DELETE /api/locations/:id`

All mutating browser requests require the session-bound `X-CSRF-Token` header. Authentication is cookie/session based; no JWT is stored in local storage.

## Deployment outline
- GitHub: push this repository.
- Render: deploy PostgreSQL, the Python service (private service), and the Node web service. Set environment variables from `.env.example`; set `WEATHER_SERVICE_URL` to the internal Python service URL.
- Vercel: this starter serves the frontend from Node for same-origin cookies and CSRF. For a separate Vercel frontend, set `FRONTEND_ORIGIN` on Node to the exact Vercel origin and configure secure cross-site cookies (`COOKIE_SAME_SITE=none`, `COOKIE_SECURE=true`). Deploy `frontend/` as static output and set `API_BASE_URL` in `frontend/config.js` to the Node API URL. Review `docs/deployment.md` before doing this; cross-site cookies can be blocked by browser privacy settings.

Do not commit `.env`, database credentials, API secrets or production session secrets. Configure production secrets in the hosting provider dashboard. Before public launch, add automated tests, monitoring, backups, provider terms review and an independent security review.

## Current scope
This is an MVP foundation, not a Weather Underground clone. It does not yet include radar maps, station networks, historical archives, alerts or severe-weather notification delivery. Open-Meteo data availability and terms must be reviewed for the intended production use.
