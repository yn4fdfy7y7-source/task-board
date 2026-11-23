#!/usr/bin/env bash
set -eu
mkdir -p .data
if ! curl -fsS http://127.0.0.1:8001/board-config.js >/dev/null 2>&1; then
  nohup python3 server.py >.data/server.log 2>&1 </dev/null &
fi
