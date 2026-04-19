#!/usr/bin/env sh
set -eu

mode="${1:-}"
if [ -z "$mode" ]; then
  echo "Usage: sh scripts/compose-stack.sh <local|cloud> <docker-compose-subcommand> [args...]" >&2
  exit 2
fi
shift

if [ "$#" -eq 0 ]; then
  echo "Usage: sh scripts/compose-stack.sh <local|cloud> <docker-compose-subcommand> [args...]" >&2
  exit 2
fi

shared_env_file=".env"
if [ ! -f "$shared_env_file" ]; then
  echo "[compose-stack] missing required shared env file: .env" >&2
  echo "[compose-stack] create it from .env.example before running docker compose workflows" >&2
  exit 1
fi

case "$mode" in
  local)
    mode_compose_file="docker-compose.local.yml"
    mode_env_file=".env.local"
    ;;
  cloud)
    mode_compose_file="docker-compose.cloud.yml"
    mode_env_file=".env.cloud"
    ;;
  *)
    echo "[compose-stack] unsupported mode: ${mode} (expected local or cloud)" >&2
    exit 2
    ;;
esac

if [ ! -f "$mode_env_file" ]; then
  echo "[compose-stack] missing required mode env file: ${mode_env_file}" >&2
  case "$mode" in
    local)
      echo "[compose-stack] create it from .env.example.local before running local docker workflows" >&2
      ;;
    cloud)
      echo "[compose-stack] create it from .env.example.cloud before running cloud docker workflows" >&2
      ;;
  esac
  exit 1
fi

docker compose \
  --env-file "$shared_env_file" \
  --env-file "$mode_env_file" \
  -f docker-compose.yml \
  -f "$mode_compose_file" \
  "$@"
