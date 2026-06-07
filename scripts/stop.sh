#!/usr/bin/env bash
PID_DIR="/tmp/codewhale-workbench"

if [ ! -d "$PID_DIR" ]; then
    echo "No running services found."
    exit 0
fi

echo "==> Stopping CodeWhale Workbench..."

for pidfile in "$PID_DIR"/*.pid; do
    if [ -f "$pidfile" ]; then
        name=$(basename "$pidfile" .pid)
        pid=$(cat "$pidfile")
        if kill "$pid" 2>/dev/null; then
            echo "    ✓ $name stopped (pid=$pid)"
        else
            echo "    ✗ $name not running (pid=$pid)"
        fi
        rm -f "$pidfile"
    fi
done

rm -rf "$PID_DIR"
echo "==> All services stopped"
