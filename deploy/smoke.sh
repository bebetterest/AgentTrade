#!/usr/bin/env sh
set -eu

mode="${1:-}"

if [ "$mode" != "local" ] && [ "$mode" != "cloud" ]; then
  echo "Usage: sh deploy/smoke.sh <local|cloud>" >&2
  exit 2
fi

normalize_host() {
  host="${1:-}"
  case "$host" in
    ""|"0.0.0.0"|"::"|"[::]"|"*")
      echo "127.0.0.1"
      ;;
    "localhost")
      echo "127.0.0.1"
      ;;
    *)
      echo "$host"
      ;;
  esac
}

normalize_api_prefix() {
  prefix="${1:-/api}"
  if [ -z "$prefix" ]; then
    prefix="/api"
  fi
  case "$prefix" in
    /*) ;;
    *) prefix="/${prefix}" ;;
  esac
  prefix="${prefix%/}"
  if [ -z "$prefix" ]; then
    prefix="/"
  fi
  echo "$prefix"
}

build_api_path() {
  prefix="$1"
  suffix="$2"
  if [ "$prefix" = "/" ]; then
    echo "$suffix"
    return 0
  fi
  echo "${prefix}${suffix}"
}

compose_up() {
  override_file="$1"
  docker compose -f docker-compose.yml -f "$override_file" up -d --remove-orphans
}

check_url() {
  label="$1"
  url="$2"
  retries="${SMOKE_RETRIES:-40}"
  interval="${SMOKE_INTERVAL_SECONDS:-1}"
  attempt=1
  while [ "$attempt" -le "$retries" ]; do
    if curl --noproxy '*' --fail --silent -o /dev/null "$url"; then
      echo "[ok] $label -> $url"
      return 0
    fi
    sleep "$interval"
    attempt=$((attempt + 1))
  done
  echo "[fail] $label -> $url (retries=${retries})" >&2
  return 1
}

if [ "$mode" = "local" ]; then
  compose_up "docker-compose.local.yml"

  api_host="$(normalize_host "${LOCAL_API_BIND_HOST:-127.0.0.1}")"
  api_port="${LOCAL_API_PORT:-3000}"
  web_host="$(normalize_host "${LOCAL_WEB_BIND_HOST:-127.0.0.1}")"
  web_port="${LOCAL_WEB_PORT:-3001}"

  check_url "local web" "http://${web_host}:${web_port}/"
  check_url "local api health" "http://${api_host}:${api_port}/health"
  check_url "local api summary" "http://${api_host}:${api_port}/v1/dashboard/summary?tz=UTC"

  echo "Local smoke checks passed."
  exit 0
fi

compose_up "docker-compose.cloud.yml"

cloud_host="$(normalize_host "${CLOUD_HTTP_BIND_HOST:-127.0.0.1}")"
cloud_port="${CLOUD_HTTP_PORT:-80}"
api_prefix="$(normalize_api_prefix "${CLOUD_API_PATH_PREFIX:-/api}")"
cloud_api_health_path="$(build_api_path "$api_prefix" "/health")"
cloud_api_summary_path="$(build_api_path "$api_prefix" "/v1/dashboard/summary?tz=UTC")"

base_url="http://${cloud_host}:${cloud_port}"
check_url "cloud web root" "${base_url}/"
check_url "cloud gateway health" "${base_url}/healthz"
check_url "cloud api health" "${base_url}${cloud_api_health_path}"
check_url "cloud api summary" "${base_url}${cloud_api_summary_path}"

echo "Cloud smoke checks passed."
