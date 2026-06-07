# Web Workbench — CodeWhale 局域网前端

基于 CodeWhale Runtime API (`codewhale serve --http`) 的 Web 前端工作台。

## 架构

```
浏览器 (LAN) ──HTTP/SSE──> Web Workbench (Next.js) ──HTTP/SSE──> codewhale serve --http
                                                                    ├── /v1/threads
                                                                    ├── /v1/threads/{id}/resume
                                                                    └── SSE events
```

## 快速开始

### 1. 启动 CodeWhale Runtime API

```bash
codewhale serve --http --host 0.0.0.0 --port 7878 --auth-token dev-token
```

记下终端输出的局域网 URL。

### 2. 启动工作台前端

```bash
cd web-workbench
cp .env.example .env.local   # 填写 RUNTIME_API_URL 和 AUTH_TOKEN
npm install
npm run dev                   # http://localhost:3000
```

### 3. 局域网访问

浏览器打开 `http://<你的局域网IP>:3000`

## 功能规划

- [ ] Thread 列表（创建/删除/搜索）
- [ ] 实时对话界面（SSE 流式输出）
- [ ] Tool 审批面板（approve/reject）
- [ ] 文件浏览（workspace 目录树）
- [ ] Skill 管理（启用/禁用/查看）
- [ ] MCP Server 状态面板
- [ ] 移动端适配（响应式）

## 技术栈（建议）

- **框架**: Next.js 15 (App Router) 或 Nuxt 3
- **样式**: Tailwind CSS
- **实时通信**: EventSource (SSE) + fetch
- **状态管理**: Zustand 或 Pinia

## Runtime API 关键端点

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/v1/threads` | GET/POST | 列出/创建会话 |
| `/v1/threads/{id}` | GET/DELETE | 查看/删除会话 |
| `/v1/threads/{id}/resume` | POST | 恢复会话（SSE 流） |
| `/v1/threads/{id}/fork` | POST | 分叉会话 |
| `/v1/approvals/{id}` | POST | 审批 Tool 调用 |

认证方式：`Authorization: Bearer <token>` 或 `?token=<token>`
