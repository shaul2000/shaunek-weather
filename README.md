# Shaunek Weather

Shaunek Weather provides location-based forecasts in a clean, responsive interface. Search for a city, see current conditions and the three-day outlook, and save places to a personal account.

## Features

- Current conditions, hourly forecasts, and three-day forecasts for searched locations.
- A live local clock for the searched location, including its date and time zone.
- Eight featured locations on the home dashboard, with **View more locations** to browse up to 55 curated cities in distinct batches.
- Optional accounts for saved places, profile details, and display preferences.
- Country and time-zone selection during registration.
- Weather data supplied by [WeatherAPI.com](https://www.weatherapi.com/), credited beside the forecast.

Weather information is for general use and is not an official alert or emergency service.

## Run locally

### Requirements

- Node.js 22 or later
- Python 3.11 or later
- PostgreSQL 15 or later
- A WeatherAPI.com key for forecast requests

### Setup

1. Create a local PostgreSQL database. Copy `backend/.env.example` to `backend/.env` only if the destination does not already exist. Set `DATABASE_URL` and a unique `SESSION_SECRET`.
2. Initialize the database from the repository root:

   ```sh
   set -a
   . backend/.env
   set +a
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/init.sql
   ```

3. Configure and start the weather service:

   ```sh
   cd weather-service
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -r requirements.txt
   if [ ! -e .env ]; then cp .env.example .env; fi
   # Set WEATHERAPI_KEY in .env before loading it.
   set -a
   . .env
   set +a
   uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```

4. In a second terminal, configure and start the API:

   ```sh
   cd backend
   if [ ! -e .env ]; then cp .env.example .env; fi
   # Set DATABASE_URL and a unique SESSION_SECRET in .env.
   npm ci
   npm run dev
   ```

5. Open [http://localhost:8080](http://localhost:8080).

Keep local `.env` files out of source control. The WeatherAPI.com key belongs only in the weather service environment; never put it in browser code or public configuration.

## Project structure

- `frontend/` — public weather experience and account pages.
- `backend/` — Express API, account sessions, and PostgreSQL access.
- `weather-service/` — private FastAPI service for provider requests and forecast normalization.
- `docs/` — product requirements, architecture, development, and deployment guidance.

The browser communicates with the Node API. The Node API communicates with PostgreSQL and the private weather service. Do not expose the weather service directly to the public internet.

## Deployment

The deployment guide covers the recommended Vercel frontend and Render API/database/weather-service setup, required environment settings, and release checks: [docs/deployment.md](docs/deployment.md).

Before deploying, replace the API hostname placeholder in `frontend/vercel.json` with the actual Render API hostname. Production also requires HTTPS, secure session settings, and secrets configured in the hosting provider rather than committed to the repository.

## Development and validation

The local development workflow and release checks are in [docs/development.md](docs/development.md).

To run the weather-service unit tests:

```sh
cd weather-service
.venv/bin/python -m unittest discover -s tests -v
```

Account, password-recovery, and email-change flows require a database; email delivery additionally requires SMTP configuration. Use disposable test accounts and databases for integration checks.

## Current limitations

- City-name searches use the weather provider's first result when multiple locations share a name.
- Radar, historical observations, personal weather stations, and weather-alert delivery are not included.
- Email-dependent account features require a working SMTP service.
