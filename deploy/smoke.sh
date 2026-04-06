#!/usr/bin/env sh
set -eu

mode="${1:-}"

if [ "$mode" != "local" ] && [ "$mode" != "cloud" ]; then
  echo "Usage: sh deploy/smoke.sh <local|cloud>" >&2
  exit 2
fi

# Keep smoke self-contained in CI/local while still allowing explicit overrides.
: "${JWT_SECRET:=smoke-jwt-secret}"
: "${ADMIN_SERVICE_KEY:=smoke-admin-service-key}"
export JWT_SECRET ADMIN_SERVICE_KEY

to_lower() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

is_true() {
  case "$(to_lower "${1:-}")" in
    true | 1 | yes | on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

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
  docker compose -f docker-compose.yml -f "$override_file" up -d --build --remove-orphans
}

check_url() {
  label="$1"
  url="$2"
  tls_insecure="${3:-false}"
  retries="${SMOKE_RETRIES:-40}"
  interval="${SMOKE_INTERVAL_SECONDS:-1}"
  attempt=1
  while [ "$attempt" -le "$retries" ]; do
    if is_true "$tls_insecure"; then
      if curl --noproxy '*' --insecure --fail --silent -o /dev/null "$url"; then
        echo "[ok] $label -> $url"
        return 0
      fi
    elif curl --noproxy '*' --fail --silent -o /dev/null "$url"; then
      echo "[ok] $label -> $url"
      return 0
    fi
    sleep "$interval"
    attempt=$((attempt + 1))
  done
  echo "[fail] $label -> $url (retries=${retries})" >&2
  return 1
}

check_https_redirect() {
  label="$1"
  url="$2"
  expected_prefix="$3"
  retries="${SMOKE_RETRIES:-40}"
  interval="${SMOKE_INTERVAL_SECONDS:-1}"
  attempt=1
  while [ "$attempt" -le "$retries" ]; do
    result="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' "$url")"
    status_code="${result%% *}"
    redirect_url="${result#* }"

    case "$status_code" in
      301 | 302 | 307 | 308)
        case "$redirect_url" in
          "${expected_prefix}" | "${expected_prefix}"/*)
            echo "[ok] $label -> $url (${status_code} => ${redirect_url})"
            return 0
            ;;
        esac
        ;;
    esac

    sleep "$interval"
    attempt=$((attempt + 1))
  done
  echo "[fail] $label -> $url (expected HTTP redirect to ${expected_prefix}...)" >&2
  return 1
}

if [ "$mode" = "local" ]; then
  compose_up "docker-compose.local.yml"

  api_host="$(normalize_host "${LOCAL_API_BIND_HOST:-127.0.0.1}")"
  api_port="${LOCAL_API_PORT:-3000}"
  web_host="$(normalize_host "${LOCAL_WEB_BIND_HOST:-127.0.0.1}")"
  web_port="${LOCAL_WEB_PORT:-3001}"

  check_url "local web" "http://${web_host}:${web_port}/"
  check_url "local api health" "http://${api_host}:${api_port}/v2/system/health"
  check_url "local api summary" "http://${api_host}:${api_port}/v2/dashboard/summary?tz=UTC"

  echo "Local smoke checks passed."
  exit 0
fi

compose_up "docker-compose.cloud.yml"

cloud_host="$(normalize_host "${CLOUD_HTTP_BIND_HOST:-127.0.0.1}")"
cloud_port="${CLOUD_HTTP_PORT:-80}"
api_prefix="$(normalize_api_prefix "${CLOUD_API_PATH_PREFIX:-/api}")"
cloud_api_health_path="$(build_api_path "$api_prefix" "/v2/system/health")"
cloud_api_summary_path="$(build_api_path "$api_prefix" "/v2/dashboard/summary?tz=UTC")"

cloud_https_enabled="${CLOUD_HTTPS_ENABLED:-false}"
cloud_http_redirect_to_https="${CLOUD_HTTP_REDIRECT_TO_HTTPS:-false}"
cloud_https_host="$(normalize_host "${CLOUD_HTTPS_BIND_HOST:-${CLOUD_HTTP_BIND_HOST:-127.0.0.1}}")"
cloud_https_port="${CLOUD_HTTPS_PORT:-443}"
smoke_tls_insecure="${SMOKE_TLS_INSECURE:-false}"

cloud_http_base_url="http://${cloud_host}:${cloud_port}"
cloud_https_base_url="https://${cloud_https_host}:${cloud_https_port}"
if [ "$cloud_https_port" = "443" ]; then
  expected_https_redirect_prefix="https://${cloud_https_host}"
else
  expected_https_redirect_prefix="https://${cloud_https_host}:${cloud_https_port}"
fi

if is_true "$cloud_https_enabled"; then
  check_url "cloud https web root" "${cloud_https_base_url}/" "$smoke_tls_insecure"
  check_url "cloud https gateway health" "${cloud_https_base_url}/healthz" "$smoke_tls_insecure"
  check_url "cloud https api health" "${cloud_https_base_url}${cloud_api_health_path}" "$smoke_tls_insecure"
  check_url "cloud https api summary" "${cloud_https_base_url}${cloud_api_summary_path}" "$smoke_tls_insecure"

  if is_true "$cloud_http_redirect_to_https"; then
    check_url "cloud http gateway health" "${cloud_http_base_url}/healthz"
    check_https_redirect "cloud http web redirect" "${cloud_http_base_url}/" "$expected_https_redirect_prefix"
    check_https_redirect "cloud http api redirect" "${cloud_http_base_url}${cloud_api_health_path}" "$expected_https_redirect_prefix"
  else
    check_url "cloud http web root" "${cloud_http_base_url}/"
    check_url "cloud http gateway health" "${cloud_http_base_url}/healthz"
    check_url "cloud http api health" "${cloud_http_base_url}${cloud_api_health_path}"
    check_url "cloud http api summary" "${cloud_http_base_url}${cloud_api_summary_path}"
  fi
else
  check_url "cloud web root" "${cloud_http_base_url}/"
  check_url "cloud gateway health" "${cloud_http_base_url}/healthz"
  check_url "cloud api health" "${cloud_http_base_url}${cloud_api_health_path}"
  check_url "cloud api summary" "${cloud_http_base_url}${cloud_api_summary_path}"
fi

echo "Cloud smoke checks passed."
