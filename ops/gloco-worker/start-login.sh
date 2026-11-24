#!/bin/sh
set -eu

export DISPLAY=:99
mkdir -p "$HOME" /tmp/runtime-pwuser
chmod 700 /tmp/runtime-pwuser
export XDG_RUNTIME_DIR=/tmp/runtime-pwuser
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -noreset &
x11vnc -display :99 -forever -shared -nopw -listen 0.0.0.0 -rfbport 5900 -quiet &
websockify --web=/usr/share/novnc/ 6080 127.0.0.1:5900 &

if ! node -e "require('playwright')" >/dev/null 2>&1; then
  npm install --prefix /state/runtime --no-audit --no-fund playwright@1.64.1
fi

exec node /opt/gloco-login/login.mjs
