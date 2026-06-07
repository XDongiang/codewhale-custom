# CodeWhale Custom — 部署 Makefile
# 将所有定制层通过符号链接挂载到 CodeWhale 的扩展目录

SKILLS_DIR       := $(HOME)/.codewhale/skills
MCP_CONFIG       := $(HOME)/.codewhale/mcp.json
MEMORY_DIR       := $(HOME)/.codewhale/memory.d
CODEWHALE_BIN    := $(shell which codewhale 2>/dev/null || echo "")

# 当前仓库路径（Makefile 所在目录）
REPO_ROOT        := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))

.PHONY: install uninstall status check doctor start stop dev-workbench build-workbench help

SCRIPTS_DIR := $(REPO_ROOT)/scripts

## install: 部署所有定制层到 CodeWhale 扩展目录
install: check
	@echo "==> 创建扩展目录（如不存在）..."
	mkdir -p $(SKILLS_DIR)
	mkdir -p $(MEMORY_DIR)
	@echo ""
	@echo "==> 链接 Skills..."
	@for f in $(REPO_ROOT)/skills/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			ln -sf "$$f" "$(SKILLS_DIR)/$$name"; \
			echo "    $$name → $(SKILLS_DIR)/$$name"; \
		fi; \
	done
	@echo ""
	@echo "==> 链接 MCP 配置..."
	@if [ -f "$(REPO_ROOT)/mcp/mcp.json" ]; then \
		ln -sf "$(REPO_ROOT)/mcp/mcp.json" "$(MCP_CONFIG)"; \
		echo "    mcp.json → $(MCP_CONFIG)"; \
	else \
		echo "    (跳过，mcp/mcp.json 不存在)"; \
	fi
	@echo ""
	@echo "==> 链接 Memory 文件..."
	@for f in $(REPO_ROOT)/memory/*.md; do \
		if [ -f "$$f" ]; then \
			name=$$(basename "$$f"); \
			ln -sf "$$f" "$(MEMORY_DIR)/$$name"; \
			echo "    $$name → $(MEMORY_DIR)/$$name"; \
		fi; \
	done
	@echo ""
	@echo "部署完成。运行 'make status' 检查。"
	@echo "运行 'codewhale doctor' 确认 Skills 已加载。"

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

.PHONY: dev-workbench build-workbench

## start: 一键启动 CodeWhale Runtime + Web Workbench
start:
	@bash $(SCRIPTS_DIR)/start.sh

## stop: 停止所有服务
stop:
	@bash $(SCRIPTS_DIR)/stop.sh

## dev-workbench: 单独启动 Web Workbench 开发服务器（localhost:3000）
dev-workbench:
	@cd $(WEBBENCH_DIR) && npm run dev

## build-workbench: 构建 Web Workbench 生产版本
build-workbench:
	@cd $(WEBBENCH_DIR) && npm run build

## help: 显示帮助
help:
	@echo "CodeWhale Custom 部署工具"
	@echo ""
	@echo "  make install          部署到 ~/.codewhale/"
	@echo "  make uninstall        移除符号链接"
	@echo "  make status           查看部署状态"
	@echo "  make doctor           运行 codewhale doctor"
	@echo "  make start            一键启动 (serve + Web UI)"
	@echo "  make stop             停止所有服务"
	@echo "  make dev-workbench    单独启动 Web 工作台"
	@echo "  make build-workbench  构建 Web 工作台生产版本"
	@echo ""
