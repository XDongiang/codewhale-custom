# Web Workbench — CodeWhale 局域网前端

基于 CodeWhale Runtime API (`codewhale serve --http`) 的 Web 前端工作台。

## 快速开始

### 1. 启动 CodeWhale Runtime API

```bash
codewhale serve --http --host 0.0.0.0 --port 7878 --auth-token dev-token
```

### 2. 启动工作台前端

```bash
cd web-workbench
npm install
npm run dev                   # http://localhost:3000
```

### 3. 配置连接

打开浏览器访问 `http://localhost:3000`，在 Settings 页面填写：
- **API URL**: `http://localhost:7878`
- **Auth Token**: `dev-token`

点击 "Test Connection" 验证连通性。

### 4. 局域网访问

浏览器打开 `http://<你的局域网IP>:3000` 即可从其他设备访问。

## 功能

- **Thread 管理**: 创建、列举、删除对话线程
- **实时对话**: SSE 流式输出，markdown 渲染
- **Tool 审批**: 实时审批/拒绝 CodeWhale 的工具调用
- **连接配置**: 可视化配置 API 地址和认证 Token

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
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx              # 入口
    ├── App.tsx                # 路由
    ├── index.css              # 全局样式
    ├── types/index.ts         # 类型定义
    ├── stores/
    │   ├── settings-store.ts  # 连接配置
    │   └── chat-store.ts      # 对话状态
    ├── lib/
    │   ├── api/client.ts      # API 客户端
    │   └── hooks/useSSE.ts    # SSE Hook
    ├── components/
    │   └── layout/
    │       ├── AppShell.tsx    # 布局壳
    │       └── Sidebar.tsx    # 侧边导航
    └── pages/
        ├── ThreadList.tsx     # Thread 列表
        ├── ChatView.tsx       # 聊天界面
        └── SettingsPage.tsx   # 配置页
```

## Runtime API 端点

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/v1/threads` | GET/POST | 列出/创建会话 |
| `/v1/threads/{id}` | GET/DELETE | 查看/删除会话 |
| `/v1/threads/{id}/resume` | POST | 恢复会话（SSE 流） |
| `/v1/threads/{id}/fork` | POST | 分叉会话 |
| `/v1/approvals/{id}` | POST | 审批 Tool 调用 |
