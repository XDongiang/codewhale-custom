#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WEBBENCH_DIR="$REPO_ROOT/web-workbench"

# ── Config (可通过环境变量覆盖) ──
CODEWHALE_HOST="${CODEWHALE_HOST:-0.0.0.0}"
CODEWHALE_PORT="${CODEWHALE_PORT:-7878}"
CODEWHALE_TOKEN="${CODEWHALE_TOKEN:-dev-token}"
WEBBENCH_PORT="${WEBBENCH_PORT:-3000}"

# ── 自动创建 .env（从 .env.example 复制，如果不存在）──
if [ ! -f "$WEBBENCH_DIR/.env" ] && [ -f "$WEBBENCH_DIR/.env.example" ]; then
    cp "$WEBBENCH_DIR/.env.example" "$WEBBENCH_DIR/.env"
    echo -e "${GREEN}    ✓ .env auto-created from .env.example${NC}"
fi

PID_DIR="/tmp/codewhale-workbench"
mkdir -p "$PID_DIR"

PID_SERVE="$PID_DIR/serve.pid"
PID_WEBBENCH="$PID_DIR/web.pid"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Cleanup on exit ──
cleanup() {
    echo ""
    echo -e "${YELLOW}==> Shutting down...${NC}"

    if [ -f "$PID_WEBBENCH" ]; then
        kill $(cat "$PID_WEBBENCH") 2>/dev/null || true
        rm -f "$PID_WEBBENCH"
        echo -e "${GREEN}    ✓ Web Workbench stopped${NC}"
    fi

    if [ -f "$PID_SERVE" ]; then
        kill $(cat "$PID_SERVE") 2>/dev/null || true
        rm -f "$PID_SERVE"
        echo -e "${GREEN}    ✓ CodeWhale serve stopped${NC}"
    fi

    rm -rf "$PID_DIR"
    echo -e "${GREEN}==> All services stopped${NC}"
}
trap cleanup EXIT INT TERM

# ── 启动 CodeWhale serve ──
echo -e "${CYAN}==> Starting CodeWhale Runtime API...${NC}"
codewhale serve --http --host "$CODEWHALE_HOST" --port "$CODEWHALE_PORT" --auth-token "$CODEWHALE_TOKEN" &
SERVE_PID=$!
echo $SERVE_PID > "$PID_SERVE"

# 等待 serve 就绪
echo -n "    Waiting for serve to be ready"
for i in $(seq 1 30); do
    if curl -s "http://localhost:${CODEWHALE_PORT}/health" > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}    ✓ CodeWhale serve ready (pid=$SERVE_PID)${NC}"
        break
    fi
    echo -n "."
    sleep 0.5
done

# 检查是否真的就绪
if ! curl -s "http://localhost:${CODEWHALE_PORT}/health" > /dev/null 2>&1; then
    echo ""
    echo -e "${RED}    ✗ CodeWhale serve failed to start${NC}"
    exit 1
fi

# ── 启动 Web Workbench ──
echo ""
echo -e "${CYAN}==> Starting Web Workbench...${NC}"
cd "$WEBBENCH_DIR"
npx vite --host 0.0.0.0 --port "$WEBBENCH_PORT" &
WEBBENCH_PID=$!
echo $WEBBENCH_PID > "$PID_WEBBENCH"

# 检测 WSL 环境，获取宿主机可访问的 IP
# WSL2 通常有多个 IP：WSL 内部网桥 (198.18.x.x / 172.x.x.x)、LAN 网卡 (192.168.x.x)
# 宿主机能访问的是 LAN IP，优先选择它
WSL_IP=""
if grep -qi microsoft /proc/version 2>/dev/null; then
    WSL_IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1)
    # 如果没有私有地址（罕见），回退到第一个
    [ -z "$WSL_IP" ] && WSL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  CodeWhale Workbench 已就绪${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo ""
echo -e "  WSL 内访问:"
echo -e "    Web UI:       ${CYAN}http://localhost:${WEBBENCH_PORT}${NC}"
echo -e "    Runtime API:  ${CYAN}http://localhost:${CODEWHALE_PORT}${NC}"
if [ -n "$WSL_IP" ]; then
    echo ""
    echo -e "  宿主机 (Windows) 访问:"
    echo -e "    Web UI:       ${CYAN}http://${WSL_IP}:${WEBBENCH_PORT}${NC}"
    echo -e "    Runtime API:  ${CYAN}http://${WSL_IP}:${CODEWHALE_PORT}${NC}"
fi
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# ── 等待任意子进程退出 ──
wait
