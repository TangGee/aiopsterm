# aiopsterm

中文 | [English](README.en.md)

aiopsterm 是面向 AI 运维的桌面终端，将终端、SSH/跳板机、主机 Agent、AI 会话、文件、资产、MCP、数据库 AI、Kubernetes 和主题管理放在一个工作区。

## 安装与开发

从 https://aiopsterm.com 下载对应平台安装包；源码构建见 docs/usage/installation.md。

```bash
npm ci
npm run dev
npm run typecheck
npm test
```

平台构建和发布审计见 docs/usage/development-commands.md 与 docs/technical/development.md。

## 隐私

匿名遥测默认开启，可在设置中关闭。遥测仅用于版本、平台、架构、启动和功能使用统计；不包含终端内容、命令、路径、日志、SSH 凭据或 AI 对话内容。

## 反馈与 License

普通问题请提交 https://github.com/TangGee/aiopsterm/issues。aiopsterm 自有代码采用 Apache License 2.0，见 LICENSE；第三方依赖许可见 THIRD-PARTY-NOTICES.txt。
