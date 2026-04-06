#!/usr/bin/env sh
set -eu

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

: "${CLOUD_SERVER_NAME:=_}"
: "${CLOUD_API_PATH_PREFIX:=/api}"
: "${CLOUD_API_UPSTREAM:=http://server:3000}"
: "${CLOUD_WEB_UPSTREAM:=http://web:3000}"
: "${CLOUD_HTTPS_ENABLED:=false}"
: "${CLOUD_HTTP_REDIRECT_TO_HTTPS:=false}"
: "${CLOUD_HTTPS_PORT:=443}"
: "${CLOUD_HTTPS_CERT_FILE:=/etc/nginx/certs/fullchain.pem}"
: "${CLOUD_HTTPS_KEY_FILE:=/etc/nginx/certs/privkey.pem}"
: "${CLOUD_HTTPS_REDIRECT_PORT_SUFFIX:=}"

export CLOUD_SERVER_NAME CLOUD_API_PATH_PREFIX CLOUD_API_UPSTREAM CLOUD_WEB_UPSTREAM
export CLOUD_HTTPS_CERT_FILE CLOUD_HTTPS_KEY_FILE CLOUD_HTTPS_REDIRECT_PORT_SUFFIX

template="/opt/agentrade/nginx/cloud.http-only.conf.template"
if is_true "$CLOUD_HTTPS_ENABLED"; then
  if [ ! -r "$CLOUD_HTTPS_CERT_FILE" ] || [ ! -s "$CLOUD_HTTPS_CERT_FILE" ]; then
    echo "[gateway] CLOUD_HTTPS_ENABLED=true but cert file is missing or unreadable: ${CLOUD_HTTPS_CERT_FILE}" >&2
    exit 1
  fi
  if [ ! -r "$CLOUD_HTTPS_KEY_FILE" ] || [ ! -s "$CLOUD_HTTPS_KEY_FILE" ]; then
    echo "[gateway] CLOUD_HTTPS_ENABLED=true but key file is missing or unreadable: ${CLOUD_HTTPS_KEY_FILE}" >&2
    exit 1
  fi

  if is_true "$CLOUD_HTTP_REDIRECT_TO_HTTPS"; then
    if [ "$CLOUD_HTTPS_PORT" = "443" ]; then
      CLOUD_HTTPS_REDIRECT_PORT_SUFFIX=""
    else
      CLOUD_HTTPS_REDIRECT_PORT_SUFFIX=":${CLOUD_HTTPS_PORT}"
    fi
    export CLOUD_HTTPS_REDIRECT_PORT_SUFFIX
    template="/opt/agentrade/nginx/cloud.https.redirect.conf.template"
  else
    template="/opt/agentrade/nginx/cloud.https.no-redirect.conf.template"
  fi
fi

if [ ! -r "$template" ]; then
  echo "[gateway] nginx template is missing or unreadable: ${template}" >&2
  exit 1
fi

envsubst '$CLOUD_SERVER_NAME $CLOUD_API_PATH_PREFIX $CLOUD_API_UPSTREAM $CLOUD_WEB_UPSTREAM $CLOUD_HTTPS_CERT_FILE $CLOUD_HTTPS_KEY_FILE $CLOUD_HTTPS_REDIRECT_PORT_SUFFIX' < "$template" > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
