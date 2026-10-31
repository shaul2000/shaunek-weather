# Deployment guide

## Render
1. Push the repository to GitHub.
2. Create a Render PostgreSQL database. Use its internal connection string for the Node service.
3. Create a private Render web service for `weather-service` (Python, build command `pip install -r requirements.txt`, start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`). If Render does not support private service on your plan, restrict access with a shared service token before exposing it.
4. Create a Render Node web service with root directory `backend`. Build command `npm install`; start command `npm start`. Note: when deploying separately, the Node service must also have access to the `frontend/` directory; easiest is deploy from repository root with a root-level build setup or deploy frontend on Vercel.
5. Set `DATABASE_URL`, `SESSION_SECRET` (random, 48+ characters), `WEATHER_SERVICE_URL`, `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and `FRONTEND_ORIGIN=https://YOUR-APP.vercel.app`. Enable PostgreSQL SSL as required by your provider (`PGSSL=true`).
6. Run `backend/db/init.sql` against the production database once. For a mature deployment, replace this bootstrap with versioned migrations.

## Vercel frontend
1. Import the GitHub repository into Vercel and set the root directory to `frontend`.
2. This static frontend currently uses same-origin relative `/api` URLs. Add `frontend/config.js` and API base configuration before using a separate Vercel domain, or use a Vercel rewrite/proxy to the Render API.
3. Set `FRONTEND_ORIGIN` on Render to the exact Vercel origin (e.g. `https://your-app.vercel.app`). The API allows that single origin and credentialed requests. Set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`. Third-party-cookie restrictions may still prevent this arrangement. A same-origin custom domain/reverse proxy is preferable.
4. Never put database URLs, session secrets or private service credentials in Vercel frontend environment variables.

## Production checklist
- Use strong unique secrets; never use compose defaults.
- Restrict Python service to Node service network; add service authentication if public.
- Configure exact CORS origin, HTTPS and secure cookies.
- Review Open-Meteo terms, attribution and suitability for commercial use.
- Configure logs, uptime monitoring, backups and restore tests.
- Run functional, integration and security tests before launch.
