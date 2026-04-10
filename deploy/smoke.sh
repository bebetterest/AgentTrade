#!/usr/bin/env sh
set -eu

mode="${1:-}"

if [ "$mode" != "local" ] && [ "$mode" != "cloud" ]; then
  echo "Usage: sh deploy/smoke.sh <local|cloud> [--retries <count>] [--interval <seconds>] [--tls-insecure] [--skip-up]" >&2
  exit 2
fi
shift

smoke_retries="40"
smoke_interval_seconds="1"
smoke_tls_insecure="false"
smoke_skip_up="false"

is_positive_integer() {
  value="${1:-}"
  case "$value" in
    "" | *[!0-9]*)
      return 1
      ;;
    *)
      [ "$value" -gt 0 ] 2>/dev/null
      ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      continue
      ;;
    --retries)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --retries" >&2
        exit 2
      fi
      if ! is_positive_integer "$2"; then
        echo "--retries must be a positive integer" >&2
        exit 2
      fi
      smoke_retries="$2"
      shift 2
      ;;
    --interval)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --interval" >&2
        exit 2
      fi
      if ! is_positive_integer "$2"; then
        echo "--interval must be a positive integer (seconds)" >&2
        exit 2
      fi
      smoke_interval_seconds="$2"
      shift 2
      ;;
    --tls-insecure)
      smoke_tls_insecure="true"
      shift
      ;;
    --skip-up)
      smoke_skip_up="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: sh deploy/smoke.sh <local|cloud> [--retries <count>] [--interval <seconds>] [--tls-insecure] [--skip-up]" >&2
      exit 2
      ;;
  esac
done

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
  run_mode="$1"
  sh scripts/compose-stack.sh "$run_mode" up -d --build --remove-orphans
}

read_env_value_from_file() {
  key="$1"
  file_path="$2"
  if [ ! -f "$file_path" ]; then
    echo ""
    return 0
  fi
  awk -v key="$key" '
    BEGIN {
      value = ""
    }
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      delimiter = index($0, "=")
      if (delimiter > 1) {
        current_key = substr($0, 1, delimiter - 1)
        if (current_key == key) {
          value = substr($0, delimiter + 1)
        }
      }
    }
    END {
      print value
    }
  ' "$file_path"
}

resolve_value() {
  key="$1"
  fallback="$2"
  mode_env_file="$3"

  env_override=""
  eval "env_override=\${$key-}"
  if [ -n "$env_override" ]; then
    echo "$env_override"
    return 0
  fi

  shared_value="$(read_env_value_from_file "$key" ".env")"
  mode_value="$(read_env_value_from_file "$key" "$mode_env_file")"

  if [ -n "$mode_value" ]; then
    echo "$mode_value"
    return 0
  fi
  if [ -n "$shared_value" ]; then
    echo "$shared_value"
    return 0
  fi
  echo "$fallback"
}

check_url() {
  label="$1"
  url="$2"
  retries="$3"
  interval="$4"
  tls_insecure="${5:-false}"
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
  retries="$4"
  interval="$5"
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
  mode_env_file=".env.local"

  if ! is_true "$smoke_skip_up"; then
    compose_up "local"
  fi

  api_host="$(normalize_host "$(resolve_value "LOCAL_API_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
  api_port="$(resolve_value "LOCAL_API_PORT" "3000" "$mode_env_file")"
  web_host="$(normalize_host "$(resolve_value "LOCAL_WEB_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
  web_port="$(resolve_value "LOCAL_WEB_PORT" "3001" "$mode_env_file")"

  check_url "local web" "http://${web_host}:${web_port}/" "$smoke_retries" "$smoke_interval_seconds"
  check_url \
    "local api health" \
    "http://${api_host}:${api_port}/v2/system/health" \
    "$smoke_retries" \
    "$smoke_interval_seconds"
  check_url \
    "local api summary" \
    "http://${api_host}:${api_port}/v2/dashboard/summary?tz=UTC" \
    "$smoke_retries" \
    "$smoke_interval_seconds"

  echo "Local smoke checks passed."
  exit 0
fi

mode_env_file=".env.cloud"

if ! is_true "$smoke_skip_up"; then
  compose_up "cloud"
fi

cloud_host="$(normalize_host "$(resolve_value "CLOUD_HTTP_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
cloud_port="$(resolve_value "CLOUD_HTTP_PORT" "80" "$mode_env_file")"
api_prefix="$(normalize_api_prefix "$(resolve_value "CLOUD_API_PATH_PREFIX" "/api" "$mode_env_file")")"
cloud_api_health_path="$(build_api_path "$api_prefix" "/v2/system/health")"
cloud_api_summary_path="$(build_api_path "$api_prefix" "/v2/dashboard/summary?tz=UTC")"

cloud_https_enabled="$(resolve_value "CLOUD_HTTPS_ENABLED" "false" "$mode_env_file")"
cloud_http_redirect_to_https="$(resolve_value "CLOUD_HTTP_REDIRECT_TO_HTTPS" "false" "$mode_env_file")"
cloud_https_host="$(normalize_host "$(resolve_value "CLOUD_HTTPS_BIND_HOST" "$cloud_host" "$mode_env_file")")"
cloud_https_port="$(resolve_value "CLOUD_HTTPS_PORT" "443" "$mode_env_file")"

cloud_http_base_url="http://${cloud_host}:${cloud_port}"
cloud_https_base_url="https://${cloud_https_host}:${cloud_https_port}"
if [ "$cloud_https_port" = "443" ]; then
  expected_https_redirect_prefix="https://${cloud_https_host}"
else
  expected_https_redirect_prefix="https://${cloud_https_host}:${cloud_https_port}"
fi

if is_true "$cloud_https_enabled"; then
  check_url \
    "cloud https web root" \
    "${cloud_https_base_url}/" \
    "$smoke_retries" \
    "$smoke_interval_seconds" \
    "$smoke_tls_insecure"
  check_url \
    "cloud https gateway health" \
    "${cloud_https_base_url}/healthz" \
    "$smoke_retries" \
    "$smoke_interval_seconds" \
    "$smoke_tls_insecure"
  check_url \
    "cloud https api health" \
    "${cloud_https_base_url}${cloud_api_health_path}" \
    "$smoke_retries" \
    "$smoke_interval_seconds" \
    "$smoke_tls_insecure"
  check_url \
    "cloud https api summary" \
    "${cloud_https_base_url}${cloud_api_summary_path}" \
    "$smoke_retries" \
    "$smoke_interval_seconds" \
    "$smoke_tls_insecure"

  if is_true "$cloud_http_redirect_to_https"; then
    check_url \
      "cloud http gateway health" \
      "${cloud_http_base_url}/healthz" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
    check_https_redirect \
      "cloud http web redirect" \
      "${cloud_http_base_url}/" \
      "$expected_https_redirect_prefix" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
    check_https_redirect \
      "cloud http api redirect" \
      "${cloud_http_base_url}${cloud_api_health_path}" \
      "$expected_https_redirect_prefix" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
  else
    check_url "cloud http web root" "${cloud_http_base_url}/" "$smoke_retries" "$smoke_interval_seconds"
    check_url \
      "cloud http gateway health" \
      "${cloud_http_base_url}/healthz" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
    check_url \
      "cloud http api health" \
      "${cloud_http_base_url}${cloud_api_health_path}" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
    check_url \
      "cloud http api summary" \
      "${cloud_http_base_url}${cloud_api_summary_path}" \
      "$smoke_retries" \
      "$smoke_interval_seconds"
  fi
else
  check_url "cloud web root" "${cloud_http_base_url}/" "$smoke_retries" "$smoke_interval_seconds"
  check_url \
    "cloud gateway health" \
    "${cloud_http_base_url}/healthz" \
    "$smoke_retries" \
    "$smoke_interval_seconds"
  check_url \
    "cloud api health" \
    "${cloud_http_base_url}${cloud_api_health_path}" \
    "$smoke_retries" \
    "$smoke_interval_seconds"
  check_url \
    "cloud api summary" \
    "${cloud_http_base_url}${cloud_api_summary_path}" \
    "$smoke_retries" \
    "$smoke_interval_seconds"
fi

echo "Cloud smoke checks passed."
