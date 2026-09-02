# CodeWhale Custom — 部署 Makefile
# 将所有定制层通过符号链接挂载到 CodeWhale 的扩展目录

SKILLS_DIR       := $(HOME)/.codewhale/skills
MCP_CONFIG       := $(HOME)/.codewhale/mcp.json
MEMORY_DIR       := $(HOME)/.codewhale/memory.d
CODEWHALE_BIN    := $(shell which codewhale 2>/dev/null || echo "")

# 当前仓库路径（Makefile 所在目录）
REPO_ROOT        := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
MCP_VENDOR       := $(REPO_ROOT)/mcp-servers

.PHONY: install uninstall status check doctor start stop dev build server dev-workbench build-workbench help

SCRIPTS_DIR := $(REPO_ROOT)/scripts

# 华师舆情 MCP 工具列表
MCP_TOOLS := \
	mcp-server-weibo:微博:git+https://github.com/Panniantong/mcp-server-weibo.git \
	xiaohongshu-cli:小红书:pip:none

PIP := $(shell command -v pip 2>/dev/null || command -v pip3 2>/dev/null || which pip 2>/dev/null || echo "")

## install: 一键部署 — MCP 工具 + Skills + MCP 配置 + Memory + Web 工作台
install: check
	@echo "==> 安装 MCP 工具..."
	@# Find pip (conda/native/python -m pip)
	@_PIP=""; \
	for p in pip pip3 "python -m pip" "python3 -m pip"; do \
		if $$p --version >/dev/null 2>&1; then _PIP="$$p"; break; fi; \
	done; \
	if [ -z "$$_PIP" ]; then \
		echo "    ⚠ 未找到 pip，跳过 MCP 安装"; \
	else \
		echo "    pip: $$_PIP"; \
		MCP_LOCAL="$(MCP_VENDOR)"; \
		if [ -d "$$MCP_LOCAL/mcp-server-weibo" ]; then \
			echo "    ✓ 微博 MCP 本地已有"; \
			$$_PIP install -e "$$MCP_LOCAL/mcp-server-weibo" 2>/dev/null || \
			$$_PIP install "$$MCP_LOCAL/mcp-server-weibo"; \
		elif command -v mcp-server-weibo >/dev/null 2>&1; then \
			echo "    ✓ 微博 MCP 已安装"; \
		else \
			echo "    ⚠ 微博 MCP 未安装（需先下载到 mcp-servers/）"; \
		fi; \
		if [ -d "$$MCP_LOCAL/xiaohongshu-cli" ]; then \
			echo "    ✓ 小红书 CLI 本地已有"; \
			$$_PIP install "$$MCP_LOCAL/xiaohongshu-cli" 2>/dev/null || true; \
		elif command -v xhs >/dev/null 2>&1; then \
			echo "    ✓ 小红书 CLI 已安装"; \
		else \
			echo "    ⚠ 小红书 CLI 未安装，运行:"; \
			echo "       cd mcp-servers && git clone https://github.com/jackwener/xiaohongshu-cli.git"; \
			echo "       支持扫码登录，不需要手动复制 Cookie"; \
		fi; \
	fi
	@# Web Workbench
	@echo ""
	@echo "==> Web 工作台..."
	@if [ -d "$(WEBBENCH_DIR)/node_modules" ]; then \
		echo "    ✓ 依赖已安装"; \
	else \
		echo "    → npm install..."; \
		cd $(WEBBENCH_DIR) && npm install; \
		echo "    ✓ 完成"; \
	fi
	@echo ""
	@echo "==> 链接文件..."
	mkdir -p $(SKILLS_DIR) $(MEMORY_DIR)
	@for f in $(REPO_ROOT)/skills/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			ln -sf "$$f" "$(SKILLS_DIR)/$$name"; \
			echo "    skills/$$name → $(SKILLS_DIR)/$$name"; \
		fi; \
	done
	@if [ -f "$(REPO_ROOT)/mcp/mcp.json" ]; then \
		ln -sf "$(REPO_ROOT)/mcp/mcp.json" "$(MCP_CONFIG)"; \
		echo "    mcp/mcp.json → $(MCP_CONFIG)"; \
	fi
	@for f in $(REPO_ROOT)/memory/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			ln -sf "$$f" "$(MEMORY_DIR)/$$name"; \
			echo "    memory/$$name → $(MEMORY_DIR)/$$name"; \
		fi; \
	done
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "✅ 部署完成。"
	@if ! command -v xhs >/dev/null 2>&1; then true; else \
		echo "💡 小红书需登录: xhs login"; \
	fi
	@echo "🚀 运行 'make start' 启动"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

## uninstall: 移除所有符号链接（保留原文件）
uninstall:
	@echo "==> 移除 Skills 链接..."
	@for f in $(REPO_ROOT)/skills/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			rm -f "$(SKILLS_DIR)/$$name"; \
			echo "    已移除 $(SKILLS_DIR)/$$name"; \
		fi; \
	done
	@echo ""
	@echo "==> 移除 MCP 配置链接..."
	@rm -f "$(MCP_CONFIG)"
	@echo "    已移除 $(MCP_CONFIG)"
	@echo ""
	@echo "==> 移除 Memory 文件链接..."
	@for f in $(REPO_ROOT)/memory/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			rm -f "$(MEMORY_DIR)/$$name"; \
			echo "    已移除 $(MEMORY_DIR)/$$name"; \
		fi; \
	done
	@echo ""
	@echo "卸载完成。所有原文件完好。"

## status: 检查部署状态
status:
	@echo "CodeWhale Custom 部署状态"
	@echo "=========================="
	@echo ""
	@echo "[CodeWhale]"
	@if [ -n "$(CODEWHALE_BIN)" ]; then \
		echo "  二进制: $(CODEWHALE_BIN)"; \
		$(CODEWHALE_BIN) --version 2>/dev/null || echo "  (无法获取版本)"; \
	else \
		echo "  未安装！请先 npm install -g codewhale"; \
	fi
	@echo ""
	@echo "[Skills] ($(SKILLS_DIR))"
	@if [ -d "$(SKILLS_DIR)" ]; then \
		for f in $(SKILLS_DIR)/*.md; do \
			if [ -f "$$f" ]; then \
				name=$$(basename "$$f"); \
				if [ -L "$$f" ]; then \
					target=$$(readlink "$$f"); \
					echo "  ✅ $$name → $$target"; \
				else \
					echo "  ⚠️  $$name (普通文件，非链接)"; \
				fi; \
			fi; \
		done; \
	else \
		echo "  ❌ 目录不存在"; \
	fi
	@echo ""
	@echo "[MCP] ($(MCP_CONFIG))"
	@if [ -L "$(MCP_CONFIG)" ]; then \
		echo "  ✅ $(MCP_CONFIG) → $$(readlink $(MCP_CONFIG))"; \
	elif [ -f "$(MCP_CONFIG)" ]; then \
		echo "  ⚠️  $(MCP_CONFIG) (普通文件，非链接)"; \
	else \
		echo "  ❌ 未配置"; \
	fi
	@echo ""
	@echo "[Memory] ($(MEMORY_DIR))"
	@if [ -d "$(MEMORY_DIR)" ]; then \
		for f in $(MEMORY_DIR)/*.md; do \
			if [ -f "$$f" ]; then \
				name=$$(basename "$$f"); \
				if [ -L "$$f" ]; then \
					target=$$(readlink "$$f"); \
					echo "  ✅ $$name → $$target"; \
				else \
					echo "  ⚠️  $$name (普通文件)"; \
				fi; \
			fi; \
		done; \
	else \
		echo "  ❌ 目录不存在"; \
	fi

## check: 检查 CodeWhale 是否安装
check:
	@if [ -z "$(CODEWHALE_BIN)" ]; then \
		echo "❌ CodeWhale 未安装。"; \
		echo "   安装命令: npm install -g codewhale"; \
		echo "   或: cargo install codewhale-cli --locked"; \
		exit 1; \
	fi

## doctor: 运行 codewhale doctor 检查整体状态
doctor: check
	@$(CODEWHALE_BIN) doctor

WEBBENCH_DIR := $(REPO_ROOT)/web-workbench
SERVER_DIR := $(REPO_ROOT)/server

.PHONY: dev-workbench build-workbench dev build server

## start: 一键启动生产形态(runtime + server:3001,需先 make build)
start:
	@MODE=prod bash $(SCRIPTS_DIR)/start.sh

## dev: 一键启动开发环境(runtime + server:8090 + Vite:3002)
dev:
	@MODE=dev bash $(SCRIPTS_DIR)/start.sh

## build: 构建 server 与 web-workbench 产物
build:
	@cd $(REPO_ROOT) && npm run build

## server: 构建并运行后端服务(单独使用)
server:
	@cd $(REPO_ROOT) && npm run build -w server && npm run start -w server

## stop: 停止所有服务
stop:
	@bash $(SCRIPTS_DIR)/stop.sh

## dev-workbench: 单独启动 Web Workbench 开发服务器
dev-workbench:
	@cd $(WEBBENCH_DIR) && npm run dev

## build-workbench: 构建 Web Workbench 生产版本
build-workbench:
	@cd $(WEBBENCH_DIR) && npm run build

## help: 显示帮助
help:
	@echo "华师 AI 工作台 — 部署工具"
	@echo ""
	@echo "  make install          部署配置(Skills + MCP + Memory)"
	@echo "  make setup-mcp        自动安装 MCP 工具(微博/小红书)"
	@echo "  make install-all      一键全部安装(MCP + 部署)"
	@echo "  make dev              开发环境(runtime + server:8090 + Vite:3002)"
	@echo "  make build            构建 server 与 web-workbench"
	@echo "  make start            生产形态(runtime + server:3001,需先 build)"
	@echo "  make server           单独构建并运行后端服务"
	@echo "  make stop             停止所有服务"
	@echo "  make status           查看部署状态"
	@echo "  make doctor           运行 codewhale doctor"
	@echo ""
