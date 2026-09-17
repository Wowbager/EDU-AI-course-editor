#!/bin/sh
# The editor runs on 3000 behind nginx, which owns $PORT and serves /player/ and
# /api/ on the same origin.
set -e

envsubst '$PORT $API_URL' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/http.d/default.conf

PORT=3000 node build/index.js &
EDITOR_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

# If either half dies, the container should die with it rather than serve a broken
# editor or an unreachable player.
wait -n "$EDITOR_PID" "$NGINX_PID"
exit $?
