# 权限体系建设方案(permission)

> 基线:foundation(9c7ee45)。决策(已拍板):三档角色 / 按角色分级可见 / 环境变量或随机密码初始化 admin。

## 1. 角色模型

| 角色 | 说明 | 可做什么 |
|---|---|---|
| `admin` 管理员 | 系统最高权限 | 用户管理(建号/改密/改角色/禁用/删除)、名单增删改(Excel/采集/清空)、全校+学院监控、全部报告(含个人报告)、备份导出/还原 |
| `school` 校级用户 | 全校监控与报告 | 只读全校名单、运行任意层级监控、查看全部报告(含个人报告);不能管理名单/用户/备份 |
| `college` 院级用户 | 本院监控与报告(绑定一个学院) | 只读本院名单、只能运行"学院"级监控且锁定本院、查看本院报告;个人报告不可见;不能管理名单/用户/备份 |

教师/学生不设登录(他们是监控对象),后续需要再加。

## 2. 数据可见性

### 名单(/api/personnel GET)

| 角色 | 返回 |
|---|---|
| admin / school | 全部条目 |
| college | 仅 `college === 用户.college` 的条目;无学院归属的条目(校级名单、未归属的个人)不可见 |

### 报告(/api/reports GET)

| 角色 | 返回 |
|---|---|
| admin / school | 全部(含个人报告) |
| college | 仅 `level === 'college' && dept === 用户.college`;个人报告(level=individual)不可见 |

### 写操作

| 操作 | 允许角色 |
|---|---|
| 名单 增/改/删/批量/替换/清空 | admin |
| 报告 创建 | 全部(scope 检查:college 只能创建 `dept === 本学院 && level === college` 的报告) |
| 报告 删除 | admin/school 任意;college 仅本学院报告 |
| 邮件 / 小红书 | 任意已登录用户 |
| 备份 导出/还原 | admin |
| 用户管理 | admin |

## 3. 认证与会话

- 密码:`node:crypto` scrypt(salt 16B,keylen 64,N=16384,r=8,p=1),常量时间比较。
- 会话:服务端 opaque token(`crypto.randomBytes(32)` hex),持久化 `server/data/sessions.json`(token → userId/expiresAt),TTL 30 天,每次请求检查过期并惰性清理。
- 端点:`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- `/api/health` 与 `/api/auth/*` 开放;其余 `/api/*` 全部要求 `Authorization: Bearer <用户token>`。
- 旧共享 AUTH_TOKEN 改为**服务端到 Runtime 的凭证**:代理 `/runtime-api/*` 时用服务器配置的 `AUTH_TOKEN` 替换入站 Authorization。浏览器不再持有共享 token。

## 4. 初始化

服务启动时 `users.json` 为空 → 自动创建 `admin`:
- 密码:`ADMIN_PASSWORD` 环境变量(优先);未设置则随机生成 12 位并**只在本次启动打印一次**到控制台。
- 首次登录后建议在"设置 → 用户管理"改密并创建院级账号。

## 5. 已知边界

- 监控执行(thread 创建)在 Runtime 侧,服务端无法可靠解析 prompt 校验监控范围;本阶段在**前端按角色限制**(院级锁本院、隐藏校级/个人等层级),服务端对监控线程本身不拦截。后续可在 Runtime 侧加审计。
- 局域网明文传输(无 TLS),密码走 HTTPS 前请勿在非信任网络使用;凭据不落日志。

## 6. 文件清单

- 服务端:`src/services/users.ts`、`src/services/sessions.ts`、`src/http/auth.ts`(扩展)、`src/app.ts`(createApp 拆分)、`src/index.ts`、`src/http/routes.ts`、`src/services/personnel.ts`、`src/services/reports.ts`、`src/http/proxy.ts`、`src/config.ts`
- 前端:`src/stores/auth-store.ts`、`src/pages/LoginPage.tsx`、`src/App.tsx`、`src/components/layout/AppShell.tsx`、`src/pages/SettingsPage.tsx`(用户管理 tab)、`src/pages/MonitorPage.tsx`、`src/components/layout/Sidebar.tsx`、`src/lib/api/server.ts`、`src/stores/settings-store.ts`
- 文档:本文件、`README.md`、`README-3588.md`(13.6)、`.env.example`、`server/README.md`
