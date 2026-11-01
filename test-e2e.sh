#!/usr/bin/env bash
set -euo pipefail
BASE=http://127.0.0.1:8080
: "${E2E_TEST_PASSWORD:?Set E2E_TEST_PASSWORD to a disposable test-account password before running this script}"
if [ "${#E2E_TEST_PASSWORD}" -lt 12 ]; then
  echo "E2E_TEST_PASSWORD must be at least 12 characters." >&2
  exit 1
fi
echo "Use this smoke test only with a disposable local database."
JAR=$(mktemp /tmp/shaunek-cookies.XXXXXX)
trap 'rm -f "$JAR"' EXIT

echo "== 1. Health =="
curl -fsS http://127.0.0.1:8001/health -o /dev/null
echo "Weather service OK"

echo "== 2. CSRF =="
CSRF_JSON=$(curl -sS -c "$JAR" "$BASE/api/csrf")
TOKEN=$(echo "$CSRF_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")

echo "== 3. Register =="
EMAIL="shaunek+$(python3 -c 'import secrets; print(secrets.token_hex(8))')@example.test"
REGISTER_BODY=$(EMAIL="$EMAIL" E2E_TEST_PASSWORD="$E2E_TEST_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["E2E_TEST_PASSWORD"],"firstName":"Shaun","lastName":"Ekong","country":"NG","region":"Lagos","timezone":"Africa/Lagos"}))')
REGISTER_RESPONSE=$(printf '%s' "$REGISTER_BODY" | curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  --data-binary @-)
TOKEN=$(printf '%s' "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
echo "Registration succeeded."

echo "== 4. Login =="
LOGIN_BODY=$(EMAIL="$EMAIL" E2E_TEST_PASSWORD="$E2E_TEST_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["E2E_TEST_PASSWORD"]}))')
LOGIN_RESPONSE=$(printf '%s' "$LOGIN_BODY" | curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  --data-binary @-)
TOKEN=$(printf '%s' "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
echo "Login succeeded."

echo "== 5. Read account profile =="
ACCOUNT_RESPONSE=$(curl -fsS -b "$JAR" "$BASE/api/account/settings")
printf '%s' "$ACCOUNT_RESPONSE" | python3 -c 'import json,sys; account=json.load(sys.stdin)["account"]; assert account["country"]=="NG" and account["region"]=="Lagos" and account["timezone"]=="Africa/Lagos"; print("Account details returned correctly.")'

echo "== 6. Update account profile =="
PROFILE_BODY=$(python3 -c 'import json; print(json.dumps({"firstName":"Shaun","lastName":"Ekong","country":"NG","region":"Abuja","timezone":"Africa/Lagos"}))')
PROFILE_RESPONSE=$(printf '%s' "$PROFILE_BODY" | curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/api/account/profile" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  --data-binary @-)
printf '%s' "$PROFILE_RESPONSE" | python3 -c 'import json,sys; account=json.load(sys.stdin)["account"]; assert account["region"]=="Abuja" and account["country"]=="NG" and account["timezone"]=="Africa/Lagos"; print("Profile update returned correctly.")'

echo "== 7. Save location =="
curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/api/locations" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  -d '{"city":"Lagos"}' -o /dev/null
echo "Saved location request succeeded."

echo "== 8. Weather proxy =="
curl -fsS "$BASE/api/weather?city=Abuja" -o /dev/null
echo "Weather proxy request succeeded."
echo "DONE"
