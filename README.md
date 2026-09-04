# 华师 AI 工作台

基于 [CodeWhale](https://github.com/Hmbown/CodeWhale) 定制的**高校舆情监控系统**,为华中师范大学提供跨平台舆情搜索、名单匹配、负面预警和结构化报告。

## 设计原则

- **零侵入**:所有定制通过符号链接挂载到 `~/.codewhale/`,不修改 CodeWhale 核心
- **可插拔**:Skill + MCP 工具按需组合,不同甲方切不同分支
- **轻量核心**:项目本身只有配置 + Skill + 后端服务 + Web 前端,核心能力由 CodeWhale 提供
- **数据积累**:关键词表和名单越用越准;名单/报告持久化在服务端(`server/data/`),不依赖浏览器缓存

## 目录结构

```
codewhale-custom/
├── skills/                        # AI Skill($skill-name 调用)
│   ├── ccnu-monitor.md            #   华师定制:搜索→甄别→名单匹配→情感分析→报告
│   ├── kb-ask.md                  #   知识库问答(仅依据原文,标注出处)
│   ├── social-research.md         #   通用跨平台调研
│   ├── content-monitor.md         #   舆情追踪与定时简报
│   └── kb-ask.md                  #   知识库问答(仅依据原文,标注出处)
├── memory/                        # 持久化记忆(注入到每次对话)
│   ├── ccnu-conventions.md        #   监控规范、平台优先级、报告标准
│   └── ccnu-keywords.md           #   关键词映射表(本体词/模糊词/排除词/学院别名)
├── mcp/                           # MCP 工具服务器配置
│   └── mcp.json                   #   微博 + 小红书 + Agent-Reach
├── mcp-servers/                   # MCP 工具本地镜像(离线安装用)
├── server/                        # 后端服务(ccnu-ai-server,Node + TS,零运行时依赖)
│   ├── src/                       #   API(名单/报告/邮件/小红书)+ Runtime 代理 + 静态服务
│   ├── data/                      #   服务端持久化(人员名单 / 舆情报告,部署时勿覆盖)
│   └── README.md
├── web-workbench/                 # Web 前端工作台(华师品牌)
├── scripts/
│   ├── start.sh                   #   一键启动(runtime + server [+ vite])
│   ├── stop.sh                    #   停止所有服务
│   └── check-mcp.sh               #   MCP 工具状态检测
└── Makefile                       #   命令入口
```

---

## 安装 CodeWhale

> ⚠️ **二选一**:不要同时用 npm 和 Cargo 安装。

### 方案 A:npm(推荐)

```bash
npm install -g codewhale@latest
```

> 要求 GLIBC ≥ 2.39(Ubuntu 24.04+、macOS、Arch 等)。

### 方案 B:Cargo(兼容老系统)

两个 crate 都必须安装:

| crate 名 | 安装的二进制 | 角色 |
|---|---|---|
| `codewhale-cli` | `codewhale` | 命令入口 |
| `codewhale-tui` | `codewhale-tui` | 运行时引擎 |

```bash
rustup update stable
cargo install codewhale-cli codewhale-tui --locked
```

### 验证

```bash
codewhale --version
codewhale doctor
```

---

## 快速开始

### 1. 下载 MCP 工具到本地

```bash
cd mcp-servers

# 微博(无需登录)
git clone https://github.com/Panniantong/mcp-server-weibo.git

# 小红书(支持扫码登录)
git clone https://github.com/jackwener/xiaohongshu-cli.git

cd ..
```

### 2. 安装依赖(仓库根目录,workspaces)

```bash
npm install
```

### 3. 一键部署定制层

```bash
make install
```

自动完成:MCP 工具安装 → Skills/MCP/Memory 符号链接。

### 4. 小红书登录(如需要)

```bash
xhs login    # 终端显示二维码,小红书 App 扫码
```

### 5. 启动

```bash
make dev      # 开发环境:runtime(:7878) + server(:8090) + Vite(:3002),浏览器打开 http://localhost:3002
make start    # 生产形态:runtime(:7878) + server(:3001,需先 make build),浏览器打开 http://localhost:3001
make build    # 构建 server 与 web-workbench 产物
```

> 端口约定:生产 **3001**(与旧 Web 同源,保证浏览器旧数据迁移时同源可读);开发 **3002**;server 开发 **8090**。

---

## 程序架构

```
浏览器(同一 origin)
   │
   ▼
┌─ 华师 AI Server(server/,Node + TS)────────── :3001 生产 / :8090 开发
│   ├── /api/auth/*、/api/users/*   登录会话 + 用户管理(RBAC 三档角色)
│   ├── /api/personnel/*   人员名单(读按角色过滤,写仅管理员)
│   ├── /api/reports/*     舆情报告 列表/新建/删除(上限 50)
│   ├── /api/mail/*        邮件发送(agently-cli,确认 token)
│   ├── /api/xhs/*         小红书状态/登录/扫码
│   ├── /runtime-api/*     反向代理 → CodeWhale Runtime(SSE 流式)
│   └── /                  生产模式静态服务(web-workbench/dist)
│
├─ Vite(纯前端,:3002)       dev 下把 /api 与 /runtime-api 代理到 server
└─ CodeWhale Runtime(:7878)  AI 引擎(codewhale serve --http)

后端之下:
  ├── Skills    ccnu-monitor / social-research / content-monitor
  ├── Memory    ccnu-conventions / ccnu-keywords(自动注入)
  ├── MCP       微博(免登录) / 小红书(扫码)
  └── AI 模型   deepseek-v4
```

| 层 | 说明 |
|---|---|
| 浏览器 | 用户交互界面,华师品牌,对话/历史/设置/舆情监控 |
| 华师 AI Server | 名单/报告持久化、邮件、小红书、Runtime 代理、生产静态服务 |
| CodeWhale Runtime | AI 引擎,提供 HTTP + SSE 接口 |
| Skills | 定制化的 AI 行为和工作流(Markdown 格式) |
| Memory | 持久化记忆,每次对话自动注入(关键词表、监控规范) |
| MCP Tools | 外部工具集成(跨平台搜索),本地安装、离线可用 |

---

## 舆情监控 Skill

| Skill | 命令 | 用途 |
|---|---|---|
| 华师监控 | `$ccnu-monitor` | 搜微博+小红书 → 关键词表匹配 → 名单匹配 → 情感分析 → 结构化报告 |
| 跨平台调研 | `$social-research` | 12 个平台通用调研,输出报告 |
| 内容追踪 | `$content-monitor` | 定时扫描关键词,生成简报 |

### 使用示例

```
$ccnu-monitor 帮我搜一下文学院今天的最新信息
```

系统自动:
1. 加载 `ccnu-keywords.md` 关键词表
2. 构造搜索词(优先精确词:`华中师范大学 文学院`、`桂子山 文院`)
3. 搜索微博 + 小红书
4. 甄别结果(过滤华东师范/华南师范等混淆内容)
5. 匹配上传的名单
6. 情感分类(正面/中性/负面)
7. 生成报告(含已剔除内容章节)

---

## MCP 工具

| 工具 | 平台 | 安装源 | 登录 |
|---|---|---|---|
| `mcp-server-weibo` | 微博 | `mcp-servers/` 本地安装 | 无需 |
| `xiaohongshu-cli` | 小红书 | `mcp-servers/` 本地安装 | 扫码 |

新增工具:下载到 `mcp-servers/`,在 `mcp/mcp.json` 添加配置,`make install` 即可。

---

## 关键词表

`memory/ccnu-keywords.md` 是系统的核心数据资产:

| 类别 | 内容 |
|---|---|
| 本体词 | 华中师范大学、CCNU、桂子山、南湖校区 |
| 模糊词 | 华师(需上下文判断) |
| 排除词 | 上海/闵行→华东师范、广州/石牌→华南师范 |
| 学院别名 | 21 个学院的正式名称与简称对照 |

每次搜索 AI 自动加载,发现新别名/排除词直接编辑更新即可,越用越准。

---

## 登录与权限

三档角色(首次启动自动创建 `admin`,密码来自 `ADMIN_PASSWORD` 或随机打印):

| 角色 | 名单 | 报告 | 其它 |
|---|---|---|---|
| 管理员 | 全部 + 增删改/导入/采集 | 全部(含个人) | 用户管理、备份还原 |
| 校级用户 | 全部(只读) | 全部(含个人) | 任意层级监控 |
| 院级用户 | 本学院(只读) | 本学院学院级 | 仅学院级监控且锁定本单位;知识库仅全校+本院文件 |
| 校级用户 | 全部(只读) | 全部(含个人) | 任意层级监控;知识库全部文件 |
| 管理员 | 全部 + 增删改/导入/采集 | 全部(含个人) | 用户管理、备份还原、知识库文件上传/删除 |

登录前所有页面跳转登录页;会话 30 天有效。教师/学生是监控对象,不设登录。

## 名单管理

在 Web 工作台 **设置 → 人员名单** 页面上传 Excel 文件(.xlsx),表头需含"姓名"列;也支持"采集人员"(AI 从学院官网采集)。名单增删改仅管理员,校级/院级用户只读(院级仅见本学院)。

名单与舆情报告持久化在**服务端**(`server/data/`),所有浏览器/设备看到同一份数据;旧浏览器里的 localStorage 数据首次打开时会提示**一键迁移**。设置页"数据备份"支持导出/还原 JSON。

搜索到内容中匹配名单姓名时,报告自动标记 **【名单匹配】**。

---

## Web 工作台

### 功能

| 功能 | 说明 |
|---|---|
| 对话 | AI 对话,支持 `/` 命令(`/help`、`/clear`) |
| 历史 | 对话记录归档、重命名 |
| 舆情监控 | 六级报告(全校/学院/专业/班级/课程/个人)+ 报告列表 + 邮件发送 |
| 知识库 | 上传文件(文本/PDF)→ 智能问答(带出处)+ 文件管理(仅管理员) |
| 设置 | 服务连接、人员名单(Excel/采集)、小红书登录、用户管理(管理员)、数据备份(管理员) |
| Markdown 渲染 | 表格、代码高亮、代码复制 |

### 设置页

| 标签 | 内容 |
|---|---|
| 服务连接 | API 地址 + 认证令牌 |
| 人员名单 | 增删改查、Excel 导入、官网采集 |
| 小红书 | 扫码/浏览器登录状态 |

---

## 所有命令

| 命令 | 用途 |
|---|---|
| `make install` | 部署定制层(MCP 工具 + 符号链接) |
| `make dev` | 开发环境:runtime + server(:8090) + Vite(:3002) |
| `make start` | 生产形态:runtime + server(:3001,需先 make build) |
| `make stop` | 停止所有服务 |
| `make build` | 构建 server 与 web-workbench 产物 |
| `make status` | 查看部署状态 |
| `make uninstall` | 移除符号链接 |

---

## 更新

```bash
cargo install codewhale-cli codewhale-tui --locked   # 更新 CodeWhale 核心
git pull                                                # 更新定制层
make install                                            # 重新链接
make build                                              # 重新构建
```

## 许可

MIT
