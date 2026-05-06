#!/bin/bash
# Exchanges Infisical machine-identity creds for a token, then execs the
# upstream Hermes entrypoint with secrets injected via `infisical run`.
# Called by tini; upstream entrypoint ends with `exec hermes "$@"`.
set -euo pipefail

: "${INFISICAL_CLIENT_ID:?INFISICAL_CLIENT_ID not set}"
: "${INFISICAL_CLIENT_SECRET:?INFISICAL_CLIENT_SECRET not set}"
: "${INFISICAL_PROJECT_ID:?INFISICAL_PROJECT_ID not set}"
: "${INFISICAL_PATH:?INFISICAL_PATH not set}"
: "${INFISICAL_ENV:=prod}"

INFISICAL_TOKEN=$(
  infisical login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --silent \
    --plain
)
export INFISICAL_TOKEN

# Seed config.yaml on first boot before upstream entrypoint runs its own
# dotenv/config bootstrap, so the baked-in defaults are in place.
HERMES_HOME="${HERMES_HOME:-/opt/data}"
if [ ! -f "$HERMES_HOME/config.yaml" ]; then
  mkdir -p "$HERMES_HOME"
  cp /opt/hermes-defaults/config.yaml "$HERMES_HOME/config.yaml"
fi

exec infisical run \
  --token="$INFISICAL_TOKEN" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --env="$INFISICAL_ENV" \
  --path="$INFISICAL_PATH" \
  -- /opt/hermes/docker/entrypoint.sh "$@"
