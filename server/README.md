# ccnu-ai-server — 华师 AI 工作台后端服务

零运行时依赖(Node ≥ 22)的单进程后端:API(认证 / 用户 / 人员名单 / 舆情报告 / 邮件 / 小红书) + CodeWhale Runtime 反向代理 + 生产模式静态服务。

## 认证模型

- 用户账号由 **admin** 在「设置 → 用户管理」创建,角色三档:`admin`(管理员)/ `school`(校级)/ `college`(院级,绑定学院)。
- 登录拿 opaque 会话 token(30 天有效),所有 `/api/*`(除 health 与 login/logout)与 `/runtime-api/*` 均要求 `Authorization: Bearer <用户token>`。
- 密码 scrypt 哈希;首次启动自动创建 `admin`(见环境变量 `ADMIN_PASSWORD`)。
- **浏览器不再持有共享 token**:`/runtime-api/*` 代理时,服务端用 `AUTH_TOKEN` 替换入站 Authorization 作为到 Runtime 的凭证。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_PORT` | `3001` | 监听端口。生产 3001(与旧 Web 同源),开发常用 8090 |
| `AUTH_TOKEN` | `dev-token` | 服务端 → CodeWhale Runtime 凭证(与 `codewhale serve --auth-token` 一致) |
| `ADMIN_PASSWORD` | 随机生成 | 首次启动创建 admin 的密码(≥8 位);未设置则随机生成并仅打印一次 |
| `SESSION_TTL_DAYS` | `30` | 用户会话有效期(天) |
| `RUNTIME_URL` | `http://127.0.0.1:7878` | CodeWhale Runtime 地址 |
| `DATA_DIR` | `<仓库>/server/data` | 持久化目录(personnel / reports / users / sessions JSON,部署时不得覆盖) |
| `STATIC_DIR` | `<仓库>/web-workbench/dist`(存在时) | 生产静态目录;不设置且 dist 不存在则只提供 API |
| `XHS_BIN` | `xhs` | 小红书 CLI |
| `AGENTLY_CLI_BIN` | `agently-cli` | 邮件 CLI |

## 命令

```sh
npm run dev -w server     # tsx watch 开发
npm run build -w server   # tsc 编译到 dist/
npm run start -w server   # node dist/index.js(生产)
npm run test -w server    # vitest(单测 + 路由集成测试)
```

## 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 服务健康 + Runtime 可达性(开放) |
| `/api/auth/login` | POST | 登录,返回会话 token 与用户信息 |
| `/api/auth/logout` | POST | 注销当前会话 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/users` | GET/POST | 用户列表 / 创建(仅 admin) |
| `/api/users/:id` | PATCH/DELETE | 修改(角色/学院/密码/禁用)/ 删除(仅 admin) |
| `/api/personnel` | GET/POST/PUT/DELETE | 名单(读按角色过滤;写仅 admin) |
| `/api/personnel/:id` | PATCH/DELETE | 更新 / 删除单条(仅 admin) |
| `/api/personnel/bulk` | POST | 批量导入(仅 admin) |
| `/api/reports` | GET/POST/PUT | 报告列表/新增(读按角色过滤,写按范围校验;PUT 整表替换仅 admin) |
| `/api/reports/:id` | DELETE | 删除报告(角色范围校验) |
| `/api/kb/documents` | GET/POST | 知识库文件列表(按角色过滤)/ 上传(仅 admin) |
| `/api/kb/documents/:id` | DELETE | 删除文件(仅 admin) |
| `/api/kb/search?q=` | GET | 检索可见文件片段(BM25,返回出处) |
| `/api/kb/ask` | POST | 检索 + agent 生成回答($kb-ask skill,返回答案与依据) |
| `/api/mail/send-report` | POST | agently-cli 发送(支持确认 token) |
| `/api/xhs/status` `/api/xhs/login` `/api/xhs/login-qrcode` `/api/xhs/logout` | 任意 | 小红书 CLI + 扫码登录 |
| `/runtime-api/*` | 任意 | 反向代理到 Runtime(SSE 流式透传,注入 Runtime 凭证) |
| `/` 等 | GET | 生产模式静态 + SPA fallback |

## 权限速查

| 操作 | admin | school | college |
|---|---|---|---|
| 名单查看 | 全部 | 全部 | 仅本学院 |
| 名单增删改/批量/清空 | ✅ | ❌ | ❌ |
| 报告查看 | 全部(含个人) | 全部(含个人) | 本院学院级 |
| 报告创建/删除 | 任意 | 任意 | 仅本院(dept+level 双校验) |
| 备份导出/还原 | ✅ | ❌ | ❌ |
| 用户管理 | ✅ | ❌ | ❌ |
| 监控执行 | 全部层级 | 全部层级 | 仅学院级且锁定本院(前端限制) |
| 知识库文件 上传/删除 | ✅ | ❌ | ❌ |
| 知识库 问答/检索 | 全部文件 | 全部文件 | 全校 + 本院 |
