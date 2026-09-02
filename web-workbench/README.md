# Web Workbench — 华师 AI 工作台前端

基于 [华师 AI Server](../server/README.md)(Node 服务)与 CodeWhale Runtime API 的 Web 前端工作台。

## 架构

```
浏览器 → Vite(dev :3002) ──代理──▶ 华师 AI Server(:8090 dev / :3001 prod)
                    │                    ├── /api/*(名单/报告/邮件/小红书)
                    └────────────────────┼── /runtime-api/*(→ CodeWhale Runtime :7878)
                                         └── /(生产静态服务)
```

开发时 Vite 只做页面与代理,**邮件 / 小红书 / Runtime 代理都在 server 内**,不写死在 Vite 插件中。

## 快速开始

### 1. 启动 CodeWhale Runtime

```bash
codewhale serve --http --host 0.0.0.0 --port 7878 --auth-token dev-token
```

### 2. 启动后端服务(仓库根执行)

```bash
npm run dev:server        # http://127.0.0.1:8090(dev)
```

### 3. 启动前端

```bash
npm run dev:web           # http://localhost:3002
```

打开浏览器访问 `http://localhost:3002`。设置页"服务连接"一般无需修改(默认 `/runtime-api` 与 `/api` 相对路径由 Vite 代理到 server)。

### 4. 生产模式

```bash
npm run build             # 构建 server + web-workbench
npm run start             # server 于 :3001 提供页面 + API + 代理(同源,无需 CORS)
```

## 功能

- **Thread 管理**: 创建、列举、归档对话线程
- **实时对话**: SSE 流式输出,markdown 渲染,经 server 代理
- **Tool 审批**: 实时审批/拒绝 CodeWhale 的工具调用(自动审批开关)
- **舆情监控**: 六级报告(全校/学院/专业/班级/课程/个人),报告保存到服务端,可邮件发送
- **人员名单**: 增删改查、Excel 导入、官网采集,服务端持久化(多浏览器共享)
- **数据备份**: 设置页导出/还原 JSON(名单 + 报告)
- **小红书**: 扫码 / 浏览器登录状态管理

## 技术栈

- **构建**: Vite 6
- **框架**: React 18 + TypeScript 5
- **样式**: Tailwind CSS 3
- **路由**: React Router 6
- **状态**: Zustand 5
- **SSE**: @microsoft/fetch-event-source

## 项目结构

```
web-workbench/
├── index.html
├── package.json
├── vite.config.ts          # 仅代理 /api 与 /runtime-api → server
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx              # 入口
    ├── App.tsx                # 路由
    ├── index.css              # 全局样式
    ├── types/index.ts         # 类型定义
    ├── stores/
    │   ├── settings-store.ts  # 连接配置 + 人员名单(服务端持久化)
    │   └── chat-store.ts      # 对话状态
    ├── lib/
    │   ├── api/client.ts      # CodeWhale Runtime 客户端
    │   ├── api/server.ts      # 华师 AI Server 客户端(/api/*)
    │   ├── migration.ts       # localStorage → 服务端迁移 + 导出/还原
    │   ├── departments.ts     # 学院/部门列表
    │   ├── monitor-prompt.ts  # 舆情监控 prompt 构造
    │   └── hooks/useSSE.ts    # SSE Hook
    ├── components/
    │   ├── ModelSelector.tsx
    │   └── layout/
    │       ├── AppShell.tsx       # 布局壳(挂载名单 hydrate + 迁移横幅)
    │       ├── MigrationBanner.tsx
    │       └── Sidebar.tsx        # 侧边导航
    └── pages/
        ├── ChatView.tsx       # 聊天界面
        ├── HistoryPage.tsx    # 历史
        ├── MonitorPage.tsx    # 舆情监控
        └── SettingsPage.tsx   # 设置(连接/名单/小红书/备份)
```

## Runtime API 端点(经 /runtime-api 代理)

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/v1/threads` | GET/POST | 列出/创建会话 |
| `/v1/threads/{id}` | GET/DELETE | 查看/删除会话 |
| `/v1/threads/{id}/resume` | POST | 恢复会话(SSE 流) |
| `/v1/threads/{id}/fork` | POST | 分叉会话 |
| `/v1/approvals/{id}` | POST | 审批 Tool 调用 |

Server 自有 API(`/api/personnel/*`、`/api/reports/*`、`/api/mail/send-report`、`/api/xhs/*`)见 [server/README.md](../server/README.md)。
