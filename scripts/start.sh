#!/usr/bin/env bash
# 华师 AI 工作台 一键启动
#   MODE=dev   开发:runtime(:7878) + server(:8090) + Vite(:3002)
#   MODE=prod  生产形态:runtime(:7878) + server(:3001,需先 make build)
set -e

MODE="${MODE:?请设置 MODE=dev 或 MODE=prod}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WEBBENCH_DIR="$REPO_ROOT/web-workbench"
SERVER_DIR="$REPO_ROOT/server"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Config (可通过环境变量覆盖) ──
CODEWHALE_HOST="${CODEWHALE_HOST:-0.0.0.0}"
CODEWHALE_PORT="${CODEWHALE_PORT:-7878}"
CODEWHALE_TOKEN="${CODEWHALE_TOKEN:-dev-token}"
AUTH_TOKEN="${AUTH_TOKEN:-$CODEWHALE_TOKEN}"
WEBBENCH_PORT="${WEBBENCH_PORT:-3002}"

if [ "$MODE" = "prod" ]; then
    SERVER_PORT="${APP_PORT:-3001}"
else
    SERVER_PORT="${APP_PORT:-8090}"
fi

# ── 自动创建 .env(从 .env.example 复制,如果不存在)──
if [ ! -f "$WEBBENCH_DIR/.env" ] && [ -f "$WEBBENCH_DIR/.env.example" ]; then
    cp "$WEBBENCH_DIR/.env.example" "$WEBBENCH_DIR/.env"
    echo -e "${GREEN}    ✓ .env auto-created from .env.example${NC}"
fi

PID_DIR="/tmp/codewhale-workbench"
mkdir -p "$PID_DIR"

PID_SERVE="$PID_DIR/serve.pid"
PID_SERVER="$PID_DIR/server.pid"
PID_WEBBENCH="$PID_DIR/web.pid"

server_health() {
    curl -s "http://localhost:${SERVER_PORT}/api/health" > /dev/null 2>&1
}

# ── Cleanup on exit ──
cleanup() {
    echo ""
    echo -e "${YELLOW}==> Shutting down...${NC}"

    if [ -f "$PID_WEBBENCH" ]; then
        kill "$(cat "$PID_WEBBENCH")" 2>/dev/null || true
        rm -f "$PID_WEBBENCH"
        echo -e "${GREEN}    ✓ Vite stopped${NC}"
    fi
    if [ -f "$PID_SERVER" ]; then
        kill "$(cat "$PID_SERVER")" 2>/dev/null || true
        rm -f "$PID_SERVER"
        echo -e "${GREEN}    ✓ AI Server stopped${NC}"
    fi
    if [ -f "$PID_SERVE" ]; then
        kill "$(cat "$PID_SERVE")" 2>/dev/null || true
        rm -f "$PID_SERVE"
        echo -e "${GREEN}    ✓ CodeWhale Runtime stopped${NC}"
    fi

    rm -rf "$PID_DIR"
    echo -e "${GREEN}==> All services stopped${NC}"
}
trap cleanup EXIT INT TERM

# ── 启动 CodeWhale Runtime ──
echo -e "${CYAN}==> Starting CodeWhale Runtime API...${NC}"
codewhale serve --http --host "$CODEWHALE_HOST" --port "$CODEWHALE_PORT" --auth-token "$CODEWHALE_TOKEN" &
SERVE_PID=$!
echo "$SERVE_PID" > "$PID_SERVE"

echo -n "    Waiting for serve to be ready"
for _ in $(seq 1 30); do
    if curl -s "http://localhost:${CODEWHALE_PORT}/health" > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}    ✓ CodeWhale Runtime ready (pid=$SERVE_PID)${NC}"
        break
    fi
    echo -n "."
    sleep 0.5
done

if ! curl -s "http://localhost:${CODEWHALE_PORT}/health" > /dev/null 2>&1; then
    echo ""
    echo -e "${RED}    ✗ CodeWhale Runtime failed to start${NC}"
    exit 1
fi

# 查找 xhs 路径(不写死开发机路径;可用 XHS_BIN 环境变量覆盖)
XHS_BIN="${XHS_BIN:-$(command -v xhs 2>/dev/null || true)}"
export XHS_BIN

# ── 启动华师 AI Server ──
echo ""
echo -e "${CYAN}==> Starting AI Server (:${SERVER_PORT}, mode=${MODE})...${NC}"

if [ "$MODE" = "prod" ]; then
    if [ ! -f "$SERVER_DIR/dist/index.js" ]; then
        echo -e "${RED}    ✗ server/dist 不存在,请先运行 make build${NC}"
        exit 1
    fi
    (cd "$REPO_ROOT" && \
     APP_PORT="$SERVER_PORT" \
     AUTH_TOKEN="$AUTH_TOKEN" \
     RUNTIME_URL="http://127.0.0.1:${CODEWHALE_PORT}" \
     node "$SERVER_DIR/dist/index.js") &
else
    (cd "$REPO_ROOT" && \
     APP_PORT="$SERVER_PORT" \
     AUTH_TOKEN="$AUTH_TOKEN" \
     RUNTIME_URL="http://127.0.0.1:${CODEWHALE_PORT}" \
     npm run dev -w server) &
fi
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_SERVER"

echo -n "    Waiting for AI Server to be ready"
for _ in $(seq 1 40); do
    if server_health; then
        echo ""
        echo -e "${GREEN}    ✓ AI Server ready (pid=$SERVER_PID)${NC}"
        break
    fi
    echo -n "."
    sleep 0.5
done

if ! server_health; then
    echo ""
    echo -e "${RED}    ✗ AI Server failed to start${NC}"
    exit 1
fi

# ── 启动 Vite(仅 dev)──
if [ "$MODE" = "dev" ]; then
    echo ""
    echo -e "${CYAN}==> Starting Vite Workbench (:${WEBBENCH_PORT})...${NC}"
    cd "$WEBBENCH_DIR"
    npx vite --host 0.0.0.0 --port "$WEBBENCH_PORT" &
    WEBBENCH_PID=$!
    echo "$WEBBENCH_PID" > "$PID_WEBBENCH"
fi

# 检测 WSL 环境,获取宿主机可访问的 IP
WSL_IP=""
if grep -qi microsoft /proc/version 2>/dev/null; then
    WSL_IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1)
    [ -z "$WSL_IP" ] && WSL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  华师 AI 工作台已就绪 (${MODE})${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo ""
echo "  本机访问:"
if [ "$MODE" = "dev" ]; then
    echo -e "    Web UI:       ${CYAN}http://localhost:${WEBBENCH_PORT}${NC}"
fi
echo -e "    AI Server:    ${CYAN}http://localhost:${SERVER_PORT}${NC}"
echo -e "    Runtime API:  ${CYAN}http://localhost:${CODEWHALE_PORT}${NC}"
if [ -n "$WSL_IP" ]; then
    echo ""
    echo "  宿主机 (Windows) 访问:"
    if [ "$MODE" = "dev" ]; then
        echo -e "    Web UI:       ${CYAN}http://${WSL_IP}:${WEBBENCH_PORT}${NC}"
    fi
    echo -e "    AI Server:    ${CYAN}http://${WSL_IP}:${SERVER_PORT}${NC}"
    echo -e "    Runtime API:  ${CYAN}http://${WSL_IP}:${CODEWHALE_PORT}${NC}"
fi
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# ── 等待任意子进程退出 ──
wait
