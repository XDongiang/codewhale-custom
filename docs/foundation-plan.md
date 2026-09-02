# foundation 基础改造计划

> 状态:进行中。基线分支 `foundation`(自 `origin/ccnu-frontend`,cc1ed34)。
> 范围:后端服务化 + 数据层。部署治理与权限体系留待后续轮次。

## 目标架构

```
浏览器（一个 origin:3001）
   │
   ▼
┌─ 华师 AI Server（server/，Node + TS，零运行时依赖）── :3001 生产 / :8090 开发
│   ├── /api/personnel/*     人员名单 CRUD/批量导入/批量采集入库
│   ├── /api/reports/*       舆情报告 列表/新建/删除
│   ├── /api/mail/send-report   邮件（agently-cli，原样迁移）
│   ├── /api/xhs/*           小红书（原样迁移）
│   ├── /runtime-api/*       反向代理 → codewhale serve :7878（SSE 流式透传）
│   ├── /                    静态服务 web-workbench/dist（生产）+ SPA fallback
│   └── data/                personnel.json / reports.json（原子写 + 备份 + schema_version）
│
├─ Vite dev（纯前端，:3002）  dev 下仅代理 /api 与 /runtime-api → server
└─ codewhale serve :7878（不动）
```

## 关键决策

| 决策 | 结论 | 理由 |
|---|---|---|
| D1 存储 | JSON 文件仓库(Storage 接口,原子写+备份)| 3588 网络受限,避免 better-sqlite3 原生依赖;知识库模块引入 SQLite 时换实现不换接口 |
| D2 服务端 | 零依赖 node:http | 路由少,vite.config 手写 HTTP 模式可直接迁移;避免离线安装与锁文件风险 |
| D3 生产端口 | 3001 不变 | 浏览器数据按 origin 隔离,同源迁移才能读到旧 localStorage |
| D4 收件邮箱 | 留 localStorage | 单机偏好,非共享数据 |
| D5 连接配置 | 留 localStorage | 客户端设置 |

## 数据去向

| 现形态 | 位置 | 去向 |
|---|---|---|
| 邮件/小红书/Runtime 代理 | vite.config.ts | server |
| 人员名单 | localStorage codewhale-personnel | server |
| 舆情报告 | localStorage ccnu-monitor-reports-v2 | server |
| 收件邮箱 | localStorage ccnu-monitor-report-mail | 留浏览器 |
| 连接配置 | localStorage codewhale-settings | 留浏览器 |

## API 契约

- `GET /api/health` → `{ ok, runtime: { reachable } }`
- `GET /api/personnel` / `POST /api/personnel` / `PATCH /api/personnel/:id` / `DELETE /api/personnel/:id` / `POST /api/personnel/bulk`
- `GET /api/reports` / `POST /api/reports` / `DELETE /api/reports/:id`
- `POST /api/mail/send-report`、`GET /api/xhs/{status,login,login-qrcode,logout}` 契约与现状一致
- `/api/*` 需 `Authorization: Bearer <token>`;`/runtime-api/*` 透传 Authorization

## 阶段

1. Phase 0 基线:foundation 分支,root workspaces,server 骨架,.gitignore,本文档
2. Phase 1 服务端:config/http/auth/json/proxy/static/storage/personnel/reports/mail/xhs + 单测
3. Phase 2 前端:ServerApi、settings-store 异步化、MonitorPage 走 /api、一键迁移、清 vite.config 中间件
4. Phase 3 运维:env、Makefile、start.sh、README/README-3588

## 验收

- [ ] server 与 web-workbench tsc 零错误;storage 单测通过
- [ ] 两个浏览器名单/报告互相可见(服务端持久化生效)
- [ ] 邮件确认 token、小红书扫码行为与现状一致
- [ ] SSE 经代理长流正常
- [ ] 生产 :3001 页面 + API + 代理可用;dev :3002 可用
- [ ] 旧浏览器数据一键迁移成功,导出 JSON 兜底可用
