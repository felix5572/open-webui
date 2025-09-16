#!/usr/bin/env bash

# run Open WebUI and initialize (not block the front)
echo "Starting Open WebUI and initialization in background..."
nohup bash  -l -c 'cd /app/backend && env && source ./start.sh' > /var/log/start.log 2>&1 &

# run Jupyter Lab (run CMD)
exec "$@"