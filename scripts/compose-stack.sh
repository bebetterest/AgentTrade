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
  if [ -f ".env.example" ]; then
    shared_env_file=".env.example"
    echo "[compose-stack] missing .env; falling back to .env.example" >&2
  else
    echo "[compose-stack] missing shared env file: .env (and fallback .env.example not found)" >&2
    exit 1
  fi
fi

case "$mode" in
  local)
    mode_compose_file="docker-compose.local.yml"
    mode_env_file=".env.local"
    mode_example_env_file=".env.example.local"
    ;;
  cloud)
    mode_compose_file="docker-compose.cloud.yml"
    mode_env_file=".env.cloud"
    mode_example_env_file=".env.example.cloud"
    ;;
  *)
    echo "[compose-stack] unsupported mode: ${mode} (expected local or cloud)" >&2
    exit 2
    ;;
esac

if [ -f "$mode_env_file" ]; then
  docker compose \
    --env-file "$shared_env_file" \
    --env-file "$mode_env_file" \
    -f docker-compose.yml \
    -f "$mode_compose_file" \
    "$@"
elif [ -f "$mode_example_env_file" ]; then
  echo "[compose-stack] mode override file not found: ${mode_env_file}; falling back to ${mode_example_env_file}" >&2
  docker compose \
    --env-file "$shared_env_file" \
    --env-file "$mode_example_env_file" \
    -f docker-compose.yml \
    -f "$mode_compose_file" \
    "$@"
else
  echo "[compose-stack] mode override file not found: ${mode_env_file}; using shared ${shared_env_file} only" >&2
  docker compose \
    --env-file "$shared_env_file" \
    -f docker-compose.yml \
    -f "$mode_compose_file" \
    "$@"
fi
