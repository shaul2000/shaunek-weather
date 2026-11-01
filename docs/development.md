# Shaunek Weather development and release workflow

This workflow keeps changes reviewable and helps catch avoidable problems before they reach users. CI checks syntax, weather-service normalization and cache behavior, HTML structure, and local Markdown links; it does not replace behavior tests against a database or email provider. Dependabot is configured to propose weekly updates for application and workflow dependencies.

## Before changing code

1. Start from an up-to-date `main` branch and create a focused branch for the feature or fix.
2. Record the user problem, expected behavior, and acceptance checks in an issue or task.
3. Check the existing API, UI, and docs before changing shared behavior. Keep unrelated cleanup out of the change.
4. Never put real credentials, personal data, or production records in source, tests, screenshots, logs, or issue descriptions. Use local environment files and disposable test accounts.
5. Keep `WEATHERAPI_KEY` in the weather service's environment only; do not pass it to the browser or Node API.

## Before opening a pull request

1. Run the GitHub Actions checks locally:

   Activate the weather-service virtual environment with its requirements installed first (`pip install -r weather-service/requirements.txt`).

   ```sh
   node --check backend/src/server.js
   for file in frontend/*.js; do node --check "$file"; done
   python3 -m compileall -q weather-service/app
   python3 -m compileall -q weather-service/tests
   PYTHONPATH=weather-service python3 -m unittest discover -s weather-service/tests -v
   bash -n test-e2e.sh
   bash -n scripts/test-admin-bootstrap.sh
   python3 scripts/check_project.py
   git diff --check
   ```

2. Test the changed user journey in a local environment. For account, database, or email changes, exercise success and failure cases with a disposable database and test inbox.
3. Update the requirements, architecture, deployment notes, or threat model when the behavior or operational needs change.
4. Review the diff for secrets, unrelated changes, clear error handling, accessibility, responsive behavior, and migration impact.
5. Open a pull request with a concise summary, linked issue, test results, and any known limits. Require another person to review it before merging when working with a team.

## Release and operations

1. Merge only after required CI checks pass and review feedback is resolved.
2. Back up PostgreSQL before a production schema change; check that a restore works and document how to roll back the application.
3. Deploy to staging first. Verify health, weather search, authentication, saved places, email flows, and mobile layouts with non-production accounts.
4. Promote the reviewed build to production, monitor service and email errors, and roll back if critical flows fail.
5. Keep production credentials in the hosting provider's secret manager. Rotate credentials if they may have been exposed.

## Current process limits

- CI runs Python weather-data normalization and cache tests, plus static syntax, HTML and documentation-link checks. Authentication, API/database integration, and browser behavior still need automated coverage.
- `test-e2e.sh` is a manual smoke test that requires running services and a disposable local database. It creates a test account and saved place; reset the database after use.
- `scripts/test-admin-bootstrap.sh` provisions the admin once and checks sign-in, repeat-bootstrap rejection, and self-block protection. Run it only against a fresh disposable local database, never production.
- For the Render/Vercel production walkthrough and post-deploy checks, follow [docs/deployment.md](./deployment.md).
- CI does not currently run dependency vulnerability scanning, secret scanning, container scanning, or deployment automation.
- Production backups, restore drills, monitoring, and an independent security review must be configured by the operator.
- Repository administrators still need to enable Dependabot security alerts and branch protection that requires the CI check; those settings cannot be enforced by files in the repository alone.
