#!/usr/bin/env bash
set -euo pipefail

cd /repo

export CODERCLAW_STATE_DIR="/tmp/coderclaw-test"
export CODERCLAW_CONFIG_PATH="${CODERCLAW_STATE_DIR}/coderclaw.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${CODERCLAW_STATE_DIR}/credentials"
mkdir -p "${CODERCLAW_STATE_DIR}/agents/main/sessions"
echo '{}' >"${CODERCLAW_CONFIG_PATH}"
echo 'creds' >"${CODERCLAW_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${CODERCLAW_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm coderclaw reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${CODERCLAW_CONFIG_PATH}"
test ! -d "${CODERCLAW_STATE_DIR}/credentials"
test ! -d "${CODERCLAW_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${CODERCLAW_STATE_DIR}/credentials"
echo '{}' >"${CODERCLAW_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm coderclaw uninstall --state --yes --non-interactive

test ! -d "${CODERCLAW_STATE_DIR}"

echo "OK"
