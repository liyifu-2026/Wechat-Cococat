# Wechat-Cococat

微信 AI Agent 项目，包含：

- **agent-wechat-fork** — 容器内运行 WeChat 桌面客户端，通过 REST API + Bridge 实现消息收发与 AI 自动回复
- **llm_wiki** — 个人知识库（可选集成）

## 快速开始

```bash
cd agent-wechat-fork
pnpm install
pnpm build:image
pnpm dev
```

详见各子目录 README。
