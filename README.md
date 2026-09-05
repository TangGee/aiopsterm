# aiopsterm

中文 | [English](README.en.md)

aiopsterm 是面向 AI 运维的桌面终端，将终端、SSH/跳板机、主机 Agent、AI 会话、文件、资产、MCP、数据库 AI、Kubernetes 和主题管理放在一个工作区。

## 使用文档

完整文档随桌面安装包一起提供，也可以从[官网文档索引](https://aiopsterm.com/zh-cn/docs)或 GitHub 阅读：

- [使用文档索引](docs/usage/index.md)
- [双语场景化使用指南](docs/usage/best-practices/index.md)
- [产品总览与快速上手](docs/usage/best-practices/zh-CN/01-getting-started.md)
- [终端与主工作区](docs/usage/best-practices/zh-CN/02-terminal-workspace.md)
- [主机 Agent](docs/usage/best-practices/zh-CN/03-host-agent.md)
- [AI 会话管理](docs/usage/best-practices/zh-CN/05-ai-sessions.md)
- [快捷命令与宏](docs/usage/best-practices/zh-CN/06-quick-commands.md)
- [快捷键与内置命令参考](docs/usage/best-practices/zh-CN/07-shortcuts.md)
- [故障排查](docs/usage/best-practices/zh-CN/17-troubleshooting.md)

## 安装与开发

从 [aiopsterm 官网](https://aiopsterm.com) 下载对应平台安装包；源码构建见[安装与源码构建](docs/usage/installation.md)。

```bash
npm ci
npm run dev
npm run typecheck
npm test
```

平台构建和发布审计见[开发命令](docs/usage/development-commands.md)与[技术开发说明](docs/technical/development.md)。

## 隐私

匿名遥测默认开启，可在设置中关闭。遥测仅用于版本、平台、架构、启动和功能使用统计；不包含终端内容、命令、路径、日志、SSH 凭据或 AI 对话内容。

## 反馈与 License

普通问题请提交 [GitHub Issues](https://github.com/TangGee/aiopsterm/issues)。aiopsterm 自有代码采用 Apache License 2.0，见 [LICENSE](LICENSE)；第三方依赖许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
