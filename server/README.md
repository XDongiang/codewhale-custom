# ccnu-ai-server — 华师 AI 工作台后端服务

零运行时依赖(Node ≥ 22)的单进程后端:API(人员名单 / 舆情报告 / 邮件 / 小红书) + CodeWhale Runtime 反向代理 + 生产模式静态服务。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_PORT` | `3001` | 监听端口。生产 3001(与旧 Web 同源),开发常用 8090 |
| `AUTH_TOKEN` | `dev-token` | 与 `codewhale serve --auth-token` 一致;`/api/*` 需 `Authorization: Bearer` |
| `RUNTIME_URL` | `http://127.0.0.1:7878` | CodeWhale Runtime 地址 |
| `DATA_DIR` | `<仓库>/server/data` | 持久化目录(personnel.json / reports.json,部署时不得覆盖) |
| `STATIC_DIR` | `<仓库>/web-workbench/dist`(存在时) | 生产静态目录;不设置且 dist 不存在则只提供 API |
| `XHS_BIN` | `xhs` | 小红书 CLI |
| `AGENTLY_CLI_BIN` | `agently-cli` | 邮件 CLI |

## 命令

```sh
npm run dev -w server     # tsx watch 开发
npm run build -w server   # tsc 编译到 dist/
npm run start -w server   # node dist/index.js(生产)
npm run test -w server    # vitest
```

## 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 服务健康 + Runtime 可达性 |
| `/api/personnel` | GET/POST/DELETE | 名单全量 / 新增 / 清空 |
| `/api/personnel/:id` | PATCH/DELETE | 更新 / 删除单条 |
| `/api/personnel/bulk` | POST | 批量导入(Excel / 网页采集) |
| `/api/reports` | GET/POST | 报告列表(最新在前,上限 50)/ 新增 |
| `/api/reports/:id` | DELETE | 删除报告 |
| `/api/mail/send-report` | POST | agently-cli 发送(支持确认 token) |
| `/api/xhs/status` `/api/xhs/login` `/api/xhs/login-qrcode` `/api/xhs/logout` | 任意 | 小红书 CLI + 扫码登录 |
| `/runtime-api/*` | 任意 | 反向代理到 Runtime(SSE 流式透传) |
| `/` 等 | GET | 生产模式静态 + SPA fallback |

除 `/api/health` 外,所有 `/api/*` 与 `/runtime-api/*` 都要求 `Authorization: Bearer <AUTH_TOKEN>`。
