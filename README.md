# CodeWhale Custom — 前端开发定制层

基于 [CodeWhale](https://github.com/Hmbown/CodeWhale) 的深度定制配置，专注 **Web 前端开发** 场景。

## 设计原则

- **零侵入**：所有定制放在 CodeWhale 的扩展目录中，不修改核心代码
- **持续更新**：CodeWhale 本体通过 `codewhale update` 升级，定制层不受影响
- **符号链接**：一键部署，修改即生效，无需每次复制

## 目录结构

```
codewhale-custom/
├── skills/                   # 自定义 Skill（Markdown，$skill-name 调用）
│   ├── vue-component.md      #   Vue 组件生成
│   ├── tailwind-layout.md    #   Tailwind 响应式布局
│   └── api-integration.md    #   API 集成代码生成
├── mcp/                      # MCP 工具服务器配置
│   └── mcp.json              #   Playwright / Figma / 自定义工具
├── memory/                   # 持久化记忆（注入到每次对话）
│   └── frontend-conventions.md
├── web-workbench/            # 局域网 Web 前端工作台（独立项目）
└── Makefile                  # 一键部署 / 卸载 / 状态检查
```

## 快速开始

### 前提

```bash
# 确认 CodeWhale 已安装
codewhale --version

# 确认扩展目录存在
ls ~/.codewhale/skills/
```

### 部署

```bash
make install
```

这会创建符号链接：
- `skills/*` → `~/.codewhale/skills/`
- `mcp/mcp.json` → `~/.codewhale/mcp.json`
- `memory/*.md` → `~/.codewhale/memory.d/*`

### 验证

```bash
make status          # 检查所有链接状态
codewhale doctor     # 查看 CodeWhale 是否识别到 Skills
```

### 更新 CodeWhale

```bash
codewhale update     # 更新核心（不影响定制层）
git pull             # 更新定制层
make install         # 重新建立链接（如有新增文件）
```

## 使用方式

### 在 CodeWhale TUI 中调用 Skill

```
$vue-component 创建一个用户登录表单，包含邮箱和密码字段
$tailwind-layout 设计一个三栏管理后台布局
$api-integration 根据这个 OpenAPI 文档生成前端 API 层
```

### 启动局域网 Web 工作台

```bash
# 启动 Runtime API（绑定局域网）
codewhale serve --http --host 0.0.0.0 --port 7878 --auth-token your-secret

# 另开终端启动工作台前端
cd web-workbench && npm run dev
```

浏览器访问 `http://<你的局域网IP>:3000` 即可。

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

参考已有的 Skill 文件了解完整格式。

## 添加新 Skill

1. 在 `skills/` 下创建 `xxx.md`
2. 写 frontmatter + body
3. `make install`（或手动 `ln -sf $PWD/skills/xxx.md ~/.codewhale/skills/`）
4. 在 CodeWhale 中用 `$xxx` 调用

## 卸载

```bash
make uninstall    # 移除所有符号链接，不删除文件
```

## 许可

MIT — 和 CodeWhale 保持一致。
