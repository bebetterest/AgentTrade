#!/usr/bin/env sh
set -eu

mode="${1:-}"

if [ "$mode" != "local" ] && [ "$mode" != "cloud" ]; then
  echo "Usage: sh deploy/release.sh <local|cloud> [--web-url <url>] [--retries <count>] [--interval <seconds>] [--tls-insecure] [--skip-smoke] [--skip-verify]" >&2
  exit 2
fi
shift

release_web_url=""
release_retries="40"
release_interval_seconds="1"
release_tls_insecure="false"
release_skip_smoke="false"
release_skip_verify="false"

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
    "" | "0.0.0.0" | "::" | "[::]" | "*")
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

append_port_if_non_default() {
  scheme="$1"
  host="$2"
  port="$3"
  if [ "$scheme" = "http" ] && [ "$port" = "80" ]; then
    echo "http://${host}"
    return 0
  fi
  if [ "$scheme" = "https" ] && [ "$port" = "443" ]; then
    echo "https://${host}"
    return 0
  fi
  echo "${scheme}://${host}:${port}"
}

compose() {
  sh scripts/compose-stack.sh "$mode" "$@"
}

curl_fetch() {
  url="$1"
  if is_true "$release_tls_insecure"; then
    curl --noproxy '*' --insecure --fail --silent "$url"
    return $?
  fi
  curl --noproxy '*' --fail --silent "$url"
}

verify_public_bundle_once() {
  base_url="$1"
  expected_public_base="$2"

  html="$(curl_fetch "${base_url}/")" || return 1
  script_paths="$(
    printf '%s' "$html" \
      | grep -o 'src="/_next/static/chunks/[^"]*\.js"' \
      | sed 's/src="//;s/"$//' \
      | sort -u || true
  )"
  if [ -z "$script_paths" ]; then
    echo "[verify] no web chunk scripts found from ${base_url}/" >&2
    return 1
  fi

  config_chunk_path=""
  config_chunk_payload=""
  for script_path in $script_paths; do
    script_url="${base_url}${script_path}"
    payload="$(curl_fetch "$script_url")" || continue
    case "$payload" in
      *publicApiBaseUrl*)
        config_chunk_path="$script_path"
        config_chunk_payload="$payload"
        break
        ;;
    esac
  done

  if [ -z "$config_chunk_path" ]; then
    echo "[verify] no chunk with publicApiBaseUrl found from ${base_url}/_next/static/chunks" >&2
    return 1
  fi

  case "$config_chunk_payload" in
    *NEXT_PUBLIC_API_BASE_URL*)
      echo "[verify] chunk ${config_chunk_path} still references NEXT_PUBLIC_API_BASE_URL at runtime (stale/incomplete build)." >&2
      return 1
      ;;
  esac

  case "$config_chunk_payload" in
    *"$expected_public_base"*)
      echo "[ok] verified web chunk ${config_chunk_path} includes expected public API base: ${expected_public_base}"
      return 0
      ;;
    *)
      echo "[verify] chunk ${config_chunk_path} does not include expected public API base: ${expected_public_base}" >&2
      return 1
      ;;
  esac
}

verify_public_bundle() {
  base_url="$1"
  expected_public_base="$2"
  retries="$3"
  interval="$4"

  attempt=1
  while [ "$attempt" -le "$retries" ]; do
    if verify_public_bundle_once "$base_url" "$expected_public_base"; then
      return 0
    fi
    sleep "$interval"
    attempt=$((attempt + 1))
  done
  echo "[fail] web bundle verification failed after ${retries} attempts." >&2
  return 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --web-url)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --web-url" >&2
        exit 2
      fi
      release_web_url="$2"
      shift 2
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
      release_retries="$2"
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
      release_interval_seconds="$2"
      shift 2
      ;;
    --tls-insecure)
      release_tls_insecure="true"
      shift
      ;;
    --skip-smoke)
      release_skip_smoke="true"
      shift
      ;;
    --skip-verify)
      release_skip_verify="true"
      shift
      ;;
    --)
      shift
      continue
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: sh deploy/release.sh <local|cloud> [--web-url <url>] [--retries <count>] [--interval <seconds>] [--tls-insecure] [--skip-smoke] [--skip-verify]" >&2
      exit 2
      ;;
  esac
done

mode_env_file=".env.local"
expected_public_base=""
default_web_url=""

if [ "$mode" = "local" ]; then
  mode_env_file=".env.local"
  expected_public_base="$(resolve_value "NEXT_PUBLIC_API_BASE_URL" "http://localhost:3000" "$mode_env_file")"

  local_web_host="$(normalize_host "$(resolve_value "LOCAL_WEB_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
  local_web_port="$(resolve_value "LOCAL_WEB_PORT" "3001" "$mode_env_file")"
  default_web_url="http://${local_web_host}:${local_web_port}"
else
  mode_env_file=".env.cloud"
  expected_public_base="$(resolve_value "NEXT_PUBLIC_API_BASE_URL" "/api" "$mode_env_file")"

  cloud_https_enabled="$(resolve_value "CLOUD_HTTPS_ENABLED" "false" "$mode_env_file")"
  cloud_server_name="$(resolve_value "CLOUD_SERVER_NAME" "_" "$mode_env_file")"

  if is_true "$cloud_https_enabled"; then
    scheme="https"
    cloud_port="$(resolve_value "CLOUD_HTTPS_PORT" "443" "$mode_env_file")"
    if [ "$cloud_server_name" = "_" ] || [ -z "$cloud_server_name" ]; then
      cloud_server_name="$(normalize_host "$(resolve_value "CLOUD_HTTPS_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
    fi
  else
    scheme="http"
    cloud_port="$(resolve_value "CLOUD_HTTP_PORT" "80" "$mode_env_file")"
    if [ "$cloud_server_name" = "_" ] || [ -z "$cloud_server_name" ]; then
      cloud_server_name="$(normalize_host "$(resolve_value "CLOUD_HTTP_BIND_HOST" "127.0.0.1" "$mode_env_file")")"
    fi
  fi

  default_web_url="$(append_port_if_non_default "$scheme" "$cloud_server_name" "$cloud_port")"
fi

target_web_url="$release_web_url"
if [ -z "$target_web_url" ]; then
  target_web_url="$default_web_url"
fi

echo "[release] force rebuilding web image with --no-cache --pull"
compose build --pull --no-cache web

echo "[release] recreating stack with --build --force-recreate --remove-orphans"
compose up -d --build --force-recreate --remove-orphans

if ! is_true "$release_skip_smoke"; then
  echo "[release] running smoke checks"
  set -- sh deploy/smoke.sh "$mode" --skip-up --retries "$release_retries" --interval "$release_interval_seconds"
  if [ "$mode" = "cloud" ] && is_true "$release_tls_insecure"; then
    set -- "$@" --tls-insecure
  fi
  "$@"
fi

if ! is_true "$release_skip_verify"; then
  echo "[release] verifying deployed web bundle from ${target_web_url}"
  verify_public_bundle "$target_web_url" "$expected_public_base" "$release_retries" "$release_interval_seconds"
fi

echo "[release] done"
