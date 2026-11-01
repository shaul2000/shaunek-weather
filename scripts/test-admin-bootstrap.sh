#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://127.0.0.1:8080}
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL to the administrator email configured on the local API}"
: "${ADMIN_BOOTSTRAP_TOKEN:?Set ADMIN_BOOTSTRAP_TOKEN in the local API environment}"
: "${E2E_ADMIN_PASSWORD:?Set E2E_ADMIN_PASSWORD to a disposable password of at least 12 characters}"

if [ "${#E2E_ADMIN_PASSWORD}" -lt 12 ]; then
  echo "E2E_ADMIN_PASSWORD must be at least 12 characters." >&2
  exit 1
fi

case "$BASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    if [ "${E2E_ALLOW_REMOTE:-false}" != "true" ]; then
      echo "Refusing a non-local URL. Set E2E_ALLOW_REMOTE=true only for disposable staging." >&2
      exit 1
    fi
    ;;
esac

echo "Use this one-time bootstrap smoke test only with a disposable local database."
COOKIE_JAR=$(mktemp /tmp/shaunek-admin-cookies.XXXXXX)
RESPONSE_FILE=$(mktemp /tmp/shaunek-admin-response.XXXXXX)
trap 'rm -f "$COOKIE_JAR" "$RESPONSE_FILE"' EXIT

CSRF_JSON=$(curl -fsS -c "$COOKIE_JAR" "$BASE_URL/api/csrf")
CSRF_TOKEN=$(printf '%s' "$CSRF_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfToken"])')
BOOTSTRAP_BODY=$(ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_BOOTSTRAP_TOKEN="$ADMIN_BOOTSTRAP_TOKEN" E2E_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" python3 -c '
import json, os
print(json.dumps({
    "firstName": "Shaunek",
    "lastName": "Admin",
    "email": os.environ["ADMIN_EMAIL"],
    "password": os.environ["E2E_ADMIN_PASSWORD"],
    "setupToken": os.environ["ADMIN_BOOTSTRAP_TOKEN"],
}))
')
BOOTSTRAP_STATUS=$(printf '%s' "$BOOTSTRAP_BODY" | curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -o "$RESPONSE_FILE" -w '%{http_code}' -X POST "$BASE_URL/api/admin/bootstrap" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF_TOKEN" --data-binary @-)
if [ "$BOOTSTRAP_STATUS" != "201" ]; then
  echo "Admin bootstrap failed with HTTP $BOOTSTRAP_STATUS:" >&2
  cat "$RESPONSE_FILE" >&2
  exit 1
fi
echo "Bootstrap succeeded."

LOGIN_BODY=$(ADMIN_EMAIL="$ADMIN_EMAIL" E2E_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" python3 -c '
import json, os
print(json.dumps({"email": os.environ["ADMIN_EMAIL"], "password": os.environ["E2E_ADMIN_PASSWORD"]}))
')
LOGIN_RESPONSE=$(printf '%s' "$LOGIN_BODY" | curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF_TOKEN" --data-binary @-)
CSRF_TOKEN=$(printf '%s' "$LOGIN_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfToken"])')
USER_STATE=$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/auth/me")
printf '%s' "$USER_STATE" | python3 -c '
import json,sys
data=json.load(sys.stdin)
assert data["isAdmin"] is True, "provisioned account lacks admin role"
assert data["adminUsername"] == "shauAdmin", "unexpected admin username"
print("Admin login and role verified.")
'
ADMIN_ID=$(printf '%s' "$USER_STATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["user"]["id"])')

REPLAY_STATUS=$(printf '%s' "$BOOTSTRAP_BODY" | curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -o "$RESPONSE_FILE" -w '%{http_code}' -X POST "$BASE_URL/api/admin/bootstrap" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF_TOKEN" --data-binary @-)
if [ "$REPLAY_STATUS" != "409" ]; then
  echo "Expected repeated bootstrap to return HTTP 409; received $REPLAY_STATUS." >&2
  exit 1
fi
echo "Repeated bootstrap correctly rejected."

BLOCK_STATUS=$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o "$RESPONSE_FILE" -w '%{http_code}' \
  -X POST "$BASE_URL/api/admin/users/$ADMIN_ID/block" -H "X-CSRF-Token: $CSRF_TOKEN")
if [ "$BLOCK_STATUS" != "403" ]; then
  echo "Expected admin self-block to return HTTP 403; received $BLOCK_STATUS." >&2
  exit 1
fi
echo "Admin self-block correctly rejected."

echo "DONE"
