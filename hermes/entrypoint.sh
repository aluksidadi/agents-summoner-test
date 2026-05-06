#!/usr/bin/env bash
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

HERMES_HOME="${HERMES_HOME:-/opt/data}"
mkdir -p "$HERMES_HOME"
cp /opt/hermes-defaults/config.yaml "$HERMES_HOME/config.yaml"

exec infisical run \
  --token="$INFISICAL_TOKEN" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --env="$INFISICAL_ENV" \
  --path="$INFISICAL_PATH" \
  -- /opt/hermes/docker/entrypoint.sh "$@"
