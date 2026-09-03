# 3588 远端部署说明

> 最后核查日期：2026-07-27  
> SSH 别名：`3588`  
> 远端主机：`claw@192.168.2.20`  
> 本文依据远端目录、systemd unit、运行进程、服务日志和健康接口进行只读核查后整理。

## 一、部署概况

3588 上的 CodeWhale Custom 不是 Docker、Git 或 CI/CD 部署，而是：

```text
源码目录 + 本机 Node/Python 依赖 + CodeWhale 用户配置 + 用户级 systemd
```

远端系统为 ARM64 RK3588：

```text
主机名：claw-desktop
用户：claw
架构：aarch64
CPU：8 核 Cortex-A55/A76
内存：15 GiB
系统盘：59 GiB，核查时剩余约 19 GiB
```

当前服务地址：

| 服务 | 地址 | 说明 |
|---|---|---|
| Web 工作台 | `http://192.168.2.20:3001` | React/Vite 工作台 |
| Runtime API | `http://192.168.2.20:7878` | CodeWhale Runtime |
| Open Claw | `http://127.0.0.1:3000` | 已占用 3000 端口的其他服务 |

远端同时存在 `192.168.2.20` 和 `192.168.2.27` 两个地址。SSH 别名 `3588` 当前连接 `192.168.2.20`。

## 二、目录结构

### 2.1 应用目录

应用位于：

```text
/home/claw/apps/codewhale-custom/
```

当前目录约 477 MiB，主要结构如下：

```text
/home/claw/apps/codewhale-custom/
├── web-workbench/
│   ├── src/                     # React/TypeScript 源码
│   ├── public/                  # 静态资源
│   ├── node_modules/            # ARM64 Node 依赖
│   ├── dist/                    # 已生成的前端构建产物
│   ├── .env                     # 前端运行配置，不应被部署覆盖
│   └── vite.config.ts           # Runtime 代理、小红书和邮件 API
├── .venv/                       # Python 3.10 虚拟环境
│   └── bin/
│       ├── xhs                  # 小红书 CLI
│       └── mcp-server-weibo     # 微博 MCP Server
├── skills/                      # CodeWhale Skills
├── memory/                      # CodeWhale Memory
├── mcp/                         # 仓库内 MCP 配置模板
├── mcp-servers/                 # 微博 MCP 源码
├── scripts/                     # 本地启动/停止脚本
├── Makefile
└── README.md
```

### 2.2 CodeWhale 状态目录

CodeWhale 的配置和持久化数据不在应用目录，而在：

```text
/home/claw/.codewhale/
```

主要内容：

```text
~/.codewhale/
├── config.toml                  # 模型、Provider、API Key 等配置
├── mcp.json                     # 远端实际生效的 MCP 配置
├── skills/                      # 指向项目 skills/ 的符号链接
├── memory.d/                    # 指向项目 memory/ 的符号链接
├── tasks/runtime/               # Thread、Turn、Item 和事件状态
├── tool_outputs/                # 工具输出
└── secrets/                     # CodeWhale 私密配置
```

核查时 `~/.codewhale` 约 16 MiB，Runtime 状态目录约有 354 个文件。

### 2.3 其他外部状态

```text
~/.agently-cli/                  # 邮件 CLI 的配置与认证状态
~/.xiaohongshu-cli/              # 小红书登录状态
~/.agents/skills/agently-mail/   # 邮件 Skill
~/.cargo/bin/                    # CodeWhale 二进制
~/.local/opt/node-v22.23.1-linux-arm64/
                                # systemd 实际使用的 ARM64 Node 22
~/.config/systemd/user/          # CodeWhale systemd 用户服务
```

## 三、运行架构

```text
浏览器
  │
  ▼
Vite Web 工作台 :3001
  ├── /runtime-api/* ───────────────► CodeWhale Runtime :7878
  ├── /api/xhs/* ───────────────────► xhs CLI
  └── /api/mail/send-report ────────► agently-cli
                                           │
                                           ▼
                                       邮件服务

CodeWhale Runtime
  ├── ~/.codewhale/config.toml
  ├── ~/.codewhale/mcp.json
  ├── ~/.codewhale/skills/* ─────────► 项目 skills/
  ├── ~/.codewhale/memory.d/* ───────► 项目 memory/
  ├── mcp-server-weibo
  └── DeepSeek API
```

## 四、systemd 服务

远端使用 `claw` 用户的 systemd 服务，而不是仓库中的 `scripts/start.sh`。

### 4.1 Runtime 服务

文件：

```text
~/.config/systemd/user/codewhale-runtime.service
~/.config/systemd/user/codewhale-runtime.service.d/multi-origin.conf
```

主要配置：

```text
WorkingDirectory=/home/claw/apps/codewhale-custom
ExecStart=/home/claw/.cargo/bin/codewhale serve ... --port 7878
Restart=on-failure
RestartSec=3
```

Drop-in 为 Runtime 增加了以下 CORS 来源：

```text
http://192.168.2.20:3001
http://127.0.0.1:3001
http://localhost:3001
```

### 4.2 Web 服务

文件：

```text
~/.config/systemd/user/codewhale-web.service
~/.config/systemd/user/codewhale-web.service.d/original-runtime.conf
```

主 unit 原本计划执行：

```text
npm run preview -- --host 0.0.0.0 --port 3001 --strictPort
```

但 drop-in 当前将它覆盖为：

```text
npm run dev -- --host 0.0.0.0 --port 3001 --strictPort
```

同时注入：

```text
VITE_RUNTIME_API_URL=auto
VITE_AUTH_TOKEN=<由远端配置提供>
XHS_BIN=/home/claw/apps/codewhale-custom/.venv/bin/xhs
```

systemd 使用的 Node 路径为：

```text
/home/claw/.local/opt/node-v22.23.1-linux-arm64/bin
```

SSH 非交互环境默认看到的 `/usr/bin/node` 是 Node 16，部署和构建时不能依赖默认 PATH，必须显式使用 Node 22。

### 4.3 开机自启

两个服务均为 `enabled`：

```text
codewhale-runtime.service
codewhale-web.service
```

`claw` 用户启用了：

```text
Linger=yes
```

因此系统启动后，即使 `claw` 用户没有登录，用户级 systemd 服务也会自动运行。

## 五、依赖版本

### 5.1 CodeWhale

```text
codewhale       0.8.67
codewhale-tui   0.8.67
```

远端 `codewhale doctor` 核查结果：

- DeepSeek Provider 配置有效
- DeepSeek API 连接成功
- Runtime 支持 Thread、Turn、SSE 回放和外部工具
- 微博 MCP 配置存在
- ARM64 环境下 CodeWhale sandbox 不可用，Shell 工具为 best-effort 执行
- 核查时 CodeWhale 提示存在 0.9.1 更新，但尚未升级

### 5.2 Node

```text
Node.js          22.23.1
npm              10.9.8
Vite             6.4.3
React Router     6.30.4
```

### 5.3 Python

```text
Python               3.10.12
mcp-server-weibo     1.0.7
xiaohongshu-cli      0.6.4
FastMCP              3.4.4
Playwright           1.60.0
Camoufox             0.4.11
```

### 5.4 邮件

```text
agently-cli       1.0.10
```

## 六、Skills、Memory 和 MCP 的挂载方式

### 6.1 Skills

以下文件通过符号链接挂载：

```text
~/.codewhale/skills/ccnu-monitor.md
  -> /home/claw/apps/codewhale-custom/skills/ccnu-monitor.md

~/.codewhale/skills/content-monitor.md
  -> /home/claw/apps/codewhale-custom/skills/content-monitor.md

~/.codewhale/skills/social-research.md
  -> /home/claw/apps/codewhale-custom/skills/social-research.md
```

### 6.2 Memory

```text
~/.codewhale/memory.d/ccnu-conventions.md
  -> /home/claw/apps/codewhale-custom/memory/ccnu-conventions.md

~/.codewhale/memory.d/ccnu-keywords.md
  -> /home/claw/apps/codewhale-custom/memory/ccnu-keywords.md
```

### 6.3 MCP

`~/.codewhale/mcp.json` 当前是独立普通文件，不是指向仓库的符号链接。

实际生效的微博命令为：

```text
mcp-server-weibo
```

systemd 的 PATH 会优先解析到：

```text
/home/claw/apps/codewhale-custom/.venv/bin/mcp-server-weibo
```

这意味着更新仓库中的 `mcp/mcp.json` 不会自动更新远端实际配置，部署时必须单独处理 `~/.codewhale/mcp.json`。

## 七、当前运行状态

核查时：

- Runtime `/health` 返回 HTTP 200
- Web `/` 返回 HTTP 200
- `/runtime-api/v1/threads` 返回 HTTP 200
- `/api/xhs/status` 返回 HTTP 200
- 小红书处于已登录状态
- 小红书 Cookie 刷新失败，当前使用超过 7 天的已有 Cookie
- `/api/mail/send-report` 路由存在，GET 正确返回 405
- 两个 systemd 服务当前 `NRestarts=0`
- 当前稳定运行阶段没有 systemd warning

远端启动后发生过系统时间同步跳变，因此部分 systemd 启动时间、文件时间和 uptime 不完全一致，时间线只能作为近似依据。

## 八、现有部署是如何形成的

根据目录、文件时间、systemd unit 和 journal，可以还原出以下过程：

1. 将 CodeWhale Custom 源码放入 `/home/claw/apps/codewhale-custom`。
2. 使用 ARM64 Node 22 安装前端依赖。
3. 创建项目 `.venv`。
4. 在 `.venv` 中安装微博 MCP、小红书 CLI、Playwright 等依赖。
5. 将 Skills 和 Memory 链接到 `~/.codewhale/`。
6. 创建独立的 `~/.codewhale/mcp.json`，修正微博 MCP 的远端执行路径。
7. 创建并启用两个 systemd 用户服务。
8. Web 最初尝试使用 3000，发现被 Open Claw 占用后固定到 3001。
9. Web 曾短暂运行 `npm run preview`。
10. 后续直接修改远端 `vite.config.ts`，加入邮件接口和 `/runtime-api` 代理。
11. 修改 Vite 配置时移除了 `configurePreviewServer`，因此又通过 systemd drop-in 切换回 `npm run dev`。
12. Runtime 通过 drop-in 增加多个 CORS 来源。

当前应用根目录不是 Git 仓库，因此无法通过 commit 精确还原每一次变更。

## 九、部署包与现场代码的差异

远端保留了：

```text
/home/claw/codewhale-custom-rk3588.tar.gz
```

但该压缩包与当前运行目录存在差异，至少包括：

- `mcp/mcp.json`
- `web-workbench/vite.config.ts`
- `web-workbench/src/pages/SettingsPage.tsx`
- `web-workbench/src/pages/MonitorPage.tsx`
- `web-workbench/src/components/layout/Sidebar.tsx`
- `web-workbench/src/stores/settings-store.ts`
- `scripts/start.sh`

因此该压缩包不能完整代表当前运行版本，也不是可靠的完整回滚包。

其中当前项目内的 `mcp/mcp.json` 和 `scripts/start.sh` 仍包含开发机 `/home/sean/...` 路径，但生产 systemd 并不调用 `scripts/start.sh`，实际 MCP 又使用独立的 `~/.codewhale/mcp.json`，所以目前没有影响正在运行的服务。

## 十、持久化与部署边界

部署新版本时不得直接覆盖或删除：

```text
/home/claw/.codewhale/config.toml
/home/claw/.codewhale/secrets/
/home/claw/.codewhale/tasks/
/home/claw/.codewhale/tool_outputs/
/home/claw/.codewhale/mcp.json
/home/claw/.agently-cli/
/home/claw/.xiaohongshu-cli/
/home/claw/apps/codewhale-custom/web-workbench/.env
/home/claw/.config/systemd/user/codewhale-*.service
/home/claw/.config/systemd/user/codewhale-*.service.d/
```

浏览器中的以下数据保存在客户端 localStorage，而不是服务器目录：

- Runtime API 设置
- Excel 名单
- 舆情报告
- 报告收件邮箱

只要继续使用相同来源 `http://192.168.2.20:3001`，正常更新前端不会清除这些浏览器数据。

## 十一、建议的后续发布方式

不建议继续直接覆盖当前目录并在生产环境运行 Vite dev。建议改为版本化发布：

```text
/home/claw/apps/releases/
├── codewhale-custom-20260727-xxxx/
├── codewhale-custom-下一版本/
└── ...

/home/claw/apps/codewhale-custom -> 当前生效版本
```

推荐流程：

1. 备份当前应用目录、systemd unit、drop-in、`.env` 和 `~/.codewhale/mcp.json`。
2. 将新源码上传到新的 release 目录，不上传本地 x86_64 `node_modules`。
3. 显式使用远端 Node 22 执行 `npm ci`。
4. 执行 `npm run build`。
5. 创建或复用 ARM64 Python `.venv`，按需安装 MCP 和小红书依赖。
6. 恢复远端 `.env`，不要使用开发机路径。
7. 检查 Skills、Memory 符号链接和独立 MCP 配置。
8. 切换生效目录。
9. 执行 `systemctl --user daemon-reload`。
10. 重启 `codewhale-runtime.service` 和 `codewhale-web.service`。
11. 检查以下端点：
    - `/health`
    - `/runtime-api/v1/threads`
    - `/api/xhs/status`
    - `/api/mail/send-report`
12. 检查 systemd 状态和 journal。
13. 验证失败时切回上一 release。

本地当前修复后的 `vite.config.ts` 已重新支持 `configurePreviewServer`，因此下一次部署后可以将 Web systemd 服务恢复为：

```text
npm run preview -- --host 0.0.0.0 --port 3001 --strictPort
```

长期来看，建议将邮件、小红书和 Runtime 代理从 Vite 插件中拆成独立 Node 服务，避免将 Vite dev/preview 当作正式应用服务器。

## 十二、常用只读检查命令

```bash
# 连接服务器
ssh 3588

# 服务状态
systemctl --user status codewhale-runtime.service
systemctl --user status codewhale-web.service

# 完整服务定义（注意不要在公开日志中泄露 Token）
systemctl --user cat codewhale-runtime.service
systemctl --user cat codewhale-web.service

# 服务日志
journalctl --user-unit codewhale-runtime.service --no-pager
journalctl --user-unit codewhale-web.service --no-pager

# 监听端口
ss -lntp | grep -E ':(3000|3001|7878)'

# Runtime 健康检查
curl http://127.0.0.1:7878/health

# Web 页面
curl -I http://127.0.0.1:3001/

# 小红书状态
curl http://127.0.0.1:3001/api/xhs/status

# CodeWhale 检查（显式设置远端 PATH）
PATH=/home/claw/apps/codewhale-custom/.venv/bin:/home/claw/.cargo/bin:/home/claw/.local/opt/node-v22.23.1-linux-arm64/bin:/usr/local/bin:/usr/bin:/bin \
  /home/claw/.cargo/bin/codewhale doctor
```

> 注意：本文不记录任何 API Key、认证 Token 或邮件凭据。远端实际机密配置只应保存在受限权限文件中。

---

# 十三、foundation 基础改造后的部署变化(foundation 分支)

> 本节描述 `foundation` 分支相对旧版(ccnu-frontend)的部署差异。
> 旧版由 Vite dev 同时承担页面与 API(邮件/小红书/Runtime 代理),数据存浏览器 localStorage;
> foundation 版改为独立后端服务 `server/`(ccnu-ai-server)统一提供 API、代理与生产静态服务,
> 名单/报告持久化到 `server/data/`。

## 13.1 新架构

```text
浏览器(origin: http://192.168.2.20:3001)
  │
  ▼
ccnu-ai-server(node server/dist/index.js, :3001)
  ├── /api/personnel/* /api/reports/*   名单/报告(JSON 文件,原子写 + .bak 备份)
  ├── /api/mail/send-report             agently-cli
  ├── /api/xhs/*                        xhs CLI(扫码走 xvfb-run)
  ├── /runtime-api/*                    → CodeWhale Runtime :7878(SSE 流式)
  └── /                                 静态服务 web-workbench/dist(不再需要 Vite)
```

## 13.2 与旧部署的差异

| 项 | 旧版 | foundation 版 |
|---|---|---|
| Web 服务 | `codewhale-web.service`(npm run dev, Vite) | `codewhale-server.service`(node dist/index.js) |
| 端口 | Web :3001,Vite dev | server :3001(保持不变,保证迁移同源) |
| 名单/报告 | 浏览器 localStorage | `server/data/personnel.json` / `reports.json` |
| 邮件/小红书/Runtime 代理 | vite.config.ts 插件 | server 内置路由 |
| 前端 dev | Vite :3000 | Vite :3002,代理 /api 与 /runtime-api → server :8090 |
| 依赖安装 | web-workbench 单独 npm install | 仓库根 npm install(workspaces) |
| 数据迁移 | — | 旧浏览器首次打开提示一键迁移到服务器 |

## 13.3 升级步骤(3588)

1. 备份旧目录(至少含 `web-workbench/.env`、`~/.codewhale/`、`server/data/` 未生成时可跳过)。
2. 拉取 foundation 分支源码到新 release 目录,meta 到 `/home/claw/apps/releases/codewhale-custom-foundation/`。
3. 远端 Node 22 下在仓库根执行 `npm ci --omit=dev`(server 无运行时依赖,仅需 web-workbench 依赖;构建则需完整 `npm ci`)。
4. `npm run build`(构建 server 与 web-workbench)。若网络受限,先在可联网机器构建后上传 `server/dist/`、`web-workbench/dist/` 与 `node_modules`。
5. 创建/复用 Python `.venv`(xiaohongshu-cli、mcp-server-weibo 不变)。
6. 配置环境变量(写入 systemd drop-in 或 env 文件):
   - `APP_PORT=3001`(生产端口,必须与旧 Web 同源)
   - `AUTH_TOKEN=<与 codewhale serve 一致的 token>`
   - `RUNTIME_URL=http://127.0.0.1:7878`
   - `DATA_DIR=/home/claw/apps/codewhale-custom/server/data`
   - `STATIC_DIR=/home/claw/apps/codewhale-custom/web-workbench/dist`
   - `XHS_BIN=/home/claw/apps/codewhale-custom/.venv/bin/xhs`
   - `AGENTLY_CLI_BIN=agently-cli`
7. 新建 `codewhale-server.service`(用户级):

   ```ini
   [Unit]
   Description=CCNU AI Server
   After=network.target

   [Service]
   WorkingDirectory=/home/claw/apps/codewhale-custom
   ExecStart=/home/claw/.local/opt/node-v22.23.1-linux-arm64/bin/node server/dist/index.js
   Restart=on-failure
   RestartSec=3
   Environment=APP_PORT=3001
   Environment=AUTH_TOKEN=...
   Environment=RUNTIME_URL=http://127.0.0.1:7878
   Environment=DATA_DIR=/home/claw/apps/codewhale-custom/server/data
   Environment=STATIC_DIR=/home/claw/apps/codewhale-custom/web-workbench/dist
   Environment=XHS_BIN=/home/claw/apps/codewhale-custom/.venv/bin/xhs
   Environment=AGENTLY_CLI_BIN=agently-cli

   [Install]
   WantedBy=default.target
   ```

   `codewhale-runtime.service` 保持不变;旧的 `codewhale-web.service` 停用(`systemctl --user disable --now codewhale-web.service`)。若运行时需要多个 CORS 来源的旧 drop-in(`multi-origin.conf`)已不再必要:浏览器只访问 server 同源。
8. `systemctl --user daemon-reload` 并启用 server 服务。
9. 启动后核查:
   - `curl http://127.0.0.1:3001/api/health`(含 `runtime.reachable`)
   - `curl -H "Authorization: Bearer <token>" http://127.0.0.1:3001/api/personnel`
   - `curl -I http://127.0.0.1:3001/`(SPA 页面)
   - `curl http://127.0.0.1:3001/runtime-api/v1/threads`(代理透传)
   - `curl http://127.0.0.1:3001/api/xhs/status`
10. 部署新版本时**不得覆盖** `server/data/`(名单与报告的持久化目录);数据库文件为 JSON + `.bak`,如需迁移可整体拷贝。

## 13.4 浏览器数据迁移

浏览器 localStorage 中的旧名单/报告在新版首次打开时会显示"一键迁移"横幅(要求服务端名单/报告均为空)。迁移成功前不要清空浏览器数据;迁移失败可在设置页"数据备份"中导出/还原 JSON 兜底。

## 13.5 回滚

回滚 = 切回旧目录 + 恢复 `codewhale-web.service`(+ 原 drop-in),停用 `codewhale-server.service`。已迁到 `server/data/` 的数据不受影响,浏览器 localStorage 未被清除时也能退回旧版直接使用。

---

# 十四、权限体系(permission)部署说明

> foundation 之后新增的变更:服务端引入用户登录与三档角色(admin / school / college),
> 生产部署只需多配一个环境变量,其余同 13.3 节。

## 14.1 变化摘要

- 新增 `/api/auth/login|logout|me` 与 `/api/users/*`(仅 admin)。
- 所有 `/api/*`(除 health 与 login/logout)与 `/runtime-api/*` 均要求**用户会话 token**。
- **浏览器不再持有共享 token**;代理自动用服务器配置的 `AUTH_TOKEN` 访问 Runtime,原 CORS drop-in(`multi-origin.conf`)保持可移除。
- 名单/报告读取按角色过滤;名单写入、用户管理、备份还原仅 admin。

## 14.2 升级步骤增量(在 13.3 基础上)

1. 部署新 `server/dist` 前,确认 `server/data/` 中已有 `users.json` 或为空(首次启动自动建 admin)。
2. systemd unit 增加环境变量:

   ```ini
   Environment=ADMIN_PASSWORD=<首次 admin 密码(≥8 位),首次启动后建议移除>
   ```

   未设置 `ADMIN_PASSWORD` 时,服务启动会在日志打印一次随机 admin 密码。
3. 重启后核查:

   ```bash
   # 登录(替换为实际密码)
   curl -s -X POST http://127.0.0.1:3001/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"<密码>"}'
   # 用返回的 token 访问受保护接口
   curl -s http://127.0.0.1:3001/api/auth/me -H "Authorization: Bearer <token>"
   curl -s http://127.0.0.1:3001/api/personnel -H "Authorization: Bearer <token>"
   ```

4. 浏览器首次访问会跳转登录页;admin 登录后在「设置 → 用户管理」建号(院级账号必须选学院)。
5. 旧版无账号体系,升级后不存在兼容迁移;首次登录即 admin。

## 14.3 安全边界(请知悉)

- 局域网明文传输(无 TLS),请勿在非信任网络使用;密码不落日志。
- 监控线程创建在 Runtime 侧,服务端无法解析 prompt 校验监控范围,院级限制由前端 UI 承担(详见 docs/permission-plan.md「已知边界」)。
- `server/data/users.json` 与 `sessions.json` 同样属于**部署时不得覆盖**的持久化文件。
