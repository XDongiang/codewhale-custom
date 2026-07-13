#!/usr/bin/env bash
# MCP 工具状态检查 — 华师舆情监控套件

check_cmd() {
    local cmd=$1 label=$2 required=${3:-true}
    if command -v "$cmd" >/dev/null 2>&1; then
        echo "    ✓ $label 已安装"
        return 0
    else
        if [ "$required" = "true" ]; then
            echo "    ⚠ $label 未安装 — 运行 make setup-mcp 自动安装"
        else
            echo "    · $label 未安装（可选）"
        fi
    fi
}

echo "    华师舆情 MCP 工具:"
check_cmd "mcp-server-weibo" "微博搜索" "true"
check_cmd "xhs" "小红书" "false"

exit 0
