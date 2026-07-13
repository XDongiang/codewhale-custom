# MCP 工具本地镜像

把 MCP 工具下载到这里，`make install` 自动从本地安装，不再依赖 GitHub。

## 获取方式

由于网络限制，需要手动下载一次（可以换网络环境或用代理）：

### 微博 MCP
```bash
git clone https://github.com/Panniantong/mcp-server-weibo.git
```

### 小红书 CLI（支持扫码登录）
```bash
git clone https://github.com/jackwener/xiaohongshu-cli.git
# 安装后运行 xhs login，终端显示二维码，小红书 App 扫码即可
```

## 目录结构

```
mcp-servers/
├── README.md
├── mcp-server-weibo/     # 微博 MCP 服务器
└── xiaohongshu-cli/      # 小红书 CLI 工具
```

下载后运行 `make install`，会自动检测并 `pip install ./mcp-servers/mcp-server-weibo/`。
