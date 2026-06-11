[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/xdongiang-codewhale-custom-badge.png)](https://mseep.ai/app/xdongiang-codewhale-custom)

# CodeWhale Custom — 前端开发定制层

基于 [CodeWhale](https://github.com/Hmbown/CodeWhale) 的深度定制配置，专注 **Web 前端开发** 场景。

## 设计原则

- **零侵入**：所有定制放在 CodeWhale 的扩展目录中，不修改核心代码
- **持续更新**：CodeWhale 本体通过 `cargo install` 升级，定制层不受影响
- **符号链接**：一键部署，修改即生效，无需每次复制
- **一键启停**：`make start` / `make stop` 管理所有服务

## 目录结构

```
codewhale-custom/
├── skills/                        # 自定义 Skill（Markdown，$skill-name 调用）
│   ├── react-component.md         #   React 组件生成
│   ├── vue-component.md           #   Vue 组件生成（保留）
│   ├── tailwind-layout.md         #   Tailwind 响应式布局
│   └── api-integration.md         #   API 集成代码生成
├── mcp/                           # MCP 工具服务器配置
│   └── mcp.json                   #   Playwright / Filesystem
├── memory/                        # 持久化记忆（注入到每次对话）
│   └── frontend-conventions.md    #   React + TypeScript 技术栈约定
├── scripts/
│   ├── start.sh                   # 一键启动 serve + Web UI
│   └── stop.sh                    # 停止所有服务
├── web-workbench/                 # Web 前端工作台 (React + Vite + Tailwind)
└── Makefile                       # 命令入口
```

---

## 安装 CodeWhale

> ⚠️ **二选一**：不要同时用 npm 和 Cargo 安装，两个版本会装到不同目录，PATH 靠前的覆盖靠后的。
> 如果装混了，运行 `which -a codewhale` 查看，用 `npm uninstall -g codewhale` 或 `cargo uninstall codewhale-cli` 清理多余版本。

### 方案 A：npm（推荐，大部分系统适用）

```bash
npm install -g codewhale@latest
codewhale --version
```

> **要求**：GLIBC ≥ 2.39（Ubuntu 24.04+、macOS、Arch 等）。npm 包只是一个下载器，拉取 GitHub Releases 上的预编译二进制。

### 方案 B：Cargo（源码编译，兼容老系统）

适用于 Ubuntu 20.04 / Debian 10 / CentOS 7 等 GLIBC 较旧的系统。

> ⚠️ 两个 crate 都必须安装，缺一不可：
>
> | crate 名 | 安装的二进制 | 角色 |
> |---|---|---|
> | `codewhale-cli` | `codewhale` (17MB) | 命令入口 — 解析参数，调 TUI |
> | `codewhale-tui` | `codewhale-tui` (52MB) | 运行时引擎 — AI 对话、工具调用、serve HTTP 服务的核心 |
>
> CLI 本身不包含 AI 逻辑，`serve` / `run` / `exec` 等命令内部都通过 `codewhale-tui` 执行。

```bash
# 1. 确保 Rust ≥ 1.88
rustup update stable

# 2. 源码编译安装（需要 cli + tui 两个包）
cargo install codewhale-cli codewhale-tui --locked

# 3. 如果 GCC 版本过旧导致 aws-lc-sys 编译失败，换 clang
CC=clang cargo install codewhale-cli codewhale-tui --locked
```

### 验证

```bash
codewhale --version   # 应输出版本号
codewhale doctor      # 检查整体状态
```

---

## 快速开始

### 1. 部署定制层

```bash
git clone <this-repo> && cd codewhale-custom
make install
```

这会创建符号链接：
- `skills/*` → `~/.codewhale/skills/`
- `mcp/mcp.json` → `~/.codewhale/mcp.json`
- `memory/*.md` → `~/.codewhale/memory.d/*`

### 2. 安装 Web Workbench 依赖

```bash
cd web-workbench && npm install
```

### 3. 一键启动

```bash
make start
```

自动完成：
1. 后台启动 `codewhale serve --http`（端口 7878）
2. 后台启动 Vite dev server（端口 3000）
3. **Ctrl+C 自动清理所有进程**

也可以独立启停：

```bash
make stop             # 停止所有服务
make dev-workbench    # 单独启动 Web UI
```

自定义配置：

```bash
CODEWHALE_PORT=9090 WEBBENCH_PORT=4000 CODEWHALE_TOKEN=my-secret make start
```

---

## Web 工作台

浏览器打开 `http://localhost:3000`（局域网内其他设备用 `http://<IP>:3000`）。

首次使用在 **Settings** 页面配置：
- API URL: `http://localhost:7878`
- Auth Token: `dev-token`（与启动命令一致）
- 点击 **Test Connection** 验证连通性

### 功能

| 功能 | 说明 |
|---|---|
| Thread 管理 | 创建 / 删除 / 列举对话线程 |
| SSE 流式对话 | 实时流式输出，Markdown 渲染 |
| Tool 审批 | 弹出审批面板，可 Approve / Reject |
| 连接配置 | 可视化配置 API 地址和 Token，支持连通性测试 |
| 停止生成 | 流式输出中可随时 Stop |

### 技术栈

React 18 · TypeScript 5 · Vite 6 · Tailwind CSS 3 · React Router 6 · Zustand 5

---

## 在 TUI 中使用 Skill

```
$react-component 创建一个用户登录表单，包含邮箱和密码字段
$tailwind-layout 设计一个三栏管理后台布局
$api-integration 根据这个 OpenAPI 文档生成前端 API 层
```

---

## 所有命令

| 命令 | 用途 |
|---|---|
| `make install` | 部署定制层到 ~/.codewhale/ |
| `make uninstall` | 移除符号链接（不删文件） |
| `make status` | 查看部署状态 |
| `make start` | 一键启动（serve + Web UI） |
| `make stop` | 停止所有服务 |
| `make dev-workbench` | 单独启动 Web UI |
| `make build-workbench` | 构建 Web UI 生产版本 |
| `make doctor` | 运行 codewhale doctor |

---

## 自定义 Skill 格式

每个 Skill 是一个 Markdown 文件，使用 frontmatter 声明元数据：

```markdown
---
name: my-skill
description: 一句话描述这个 Skill 做什么
allowed-tools: [read_file, write_file, exec_shell]
---

# Skill 标题

## 角色
你是一个...

## 工作流程
1. 首先...
2. 然后...

## 输出规范
- 组件文件放在 src/components/ 下
- 使用 TypeScript
```

参考已有 Skill 文件了解完整格式。

## 添加新 Skill

1. 在 `skills/` 下创建 `xxx.md`
2. 写 frontmatter + body
3. `make install`（或手动 `ln -sf $PWD/skills/xxx.md ~/.codewhale/skills/`）
4. 在 CodeWhale 中用 `$xxx` 调用

## 更新

```bash
cargo install codewhale-cli --locked   # 更新 CodeWhale
git pull                                # 更新定制层
make install                            # 重新链接新文件
```

## 卸载

```bash
make uninstall    # 移除所有符号链接，不删除文件
```

## 许可

MIT
