# clawme-connector

ClawMe 的公开连接层：**零依赖 MCP Server + OpenClaw Skill + 动作协议**，MIT 许可。

ClawMe 的服务端与 iOS / Chrome / Android 客户端是专有软件；本仓只包含「怎么连」的部分，不含 relay 实现。
第三方可以照协议自建兼容 relay —— 这是特性，不是漏洞：连接层的价值是让更多人用起来，不是防守。

## 一行接入

官方托管 relay 正在内测；目前需申请凭据，尚无自助开通和付费分档。实例当前限制每租户每天 5 条新入队动作，重启后计数会清零：

```bash
export CLAWME_BASE_URL=https://relay.clawme.net
read -rs -p '请输入 ClawMe key: ' CLAWME_TOKEN; echo
export CLAWME_TOKEN
node mcp/clawme-mcp.mjs
```

MCP 客户端（Claude Code / Codex / Cursor / DSH）里也可直接挂：

```bash
claude mcp add clawme -- node /path/to/clawme-connector/mcp/clawme-mcp.mjs
```

运行 MCP 宿主的环境必须提供上面的两个变量；具体持久配置方式取决于宿主。不要把真实 key 写进命令行参数、公开配置或聊天。连接其他兼容 relay 时，将 `CLAWME_BASE_URL` 指向相应地址。

> `key` 就是账号：没有邮箱、没有找回邮件。丢了 key 等于丢了账号，先存进密码管理器。

## 四个工具，到此为止

- `clawme_notify` — 告诉人一件事，不需要回答
- `clawme_ask` — 问一个问题并等决定；超时不等于拒绝
- `clawme_action` — 备好一张卡片交给浏览器或手机执行
- `clawme_result` — 查这张卡片真实到哪一步

回执不吹牛：入队只报 `delivered: "unknown"`；`handed_off` 表示编辑器/目标页已打开，最后一下还要人按；
只有真正观测到完成才写 `ok`。

## 协议

见 [docs/protocol.md](docs/protocol.md)。HTTP 契约稳定，服务端实现可以换。

## 许可

MIT © 2026 He Fangsheng。仅覆盖本仓；ClawMe 服务端与客户端为专有软件。
