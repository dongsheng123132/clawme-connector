---
name: clawme
slug: clawme
version: 1.0.2
displayName: ClawMe 通知与确认
summary: 让 AI 把通知和审批卡送到你的 iPhone 或 Chrome，人确认后再执行。
license: MIT
homepage: https://github.com/dongsheng123132/clawme-connector
description: Send notifications and approval cards from an AI agent to the user's Chrome or iPhone via ClawMe. The person sees a card, taps once, and the device hands off to its own apps; the receipt goes back to the agent. Open protocol, MIT connector, hosted or self-hosted relay.
tags: ["notification", "human-in-the-loop", "approval", "mcp", "chrome-extension", "iphone"]
metadata: {"openclaw":{"emoji":"🦞","primaryEnv":"CLAWME_TOKEN","requires":{"env":["CLAWME_TOKEN"]}}}
---

# ClawMe — 让 AI 叫得到人

AI 把一条通知或一个待确认动作交给 ClawMe；卡片出现在用户的 Chrome 侧边栏或 iPhone 上；
人点一下，交给浏览器页面或系统原生 App 执行，回执再回到 AI。**人永远在中间。**

## 安装

1. 申请一枚 key（目前尚无自助开通；托管入口 `https://relay.clawme.net`），存进密码管理器。当前实例每日 5 条新入队动作是重启会清零的软限制。
2. 设置环境变量：

```bash
export CLAWME_BASE_URL=https://relay.clawme.net   # 自建 relay 就换成你的地址
read -rs -p '请输入 ClawMe key: ' CLAWME_TOKEN; echo
export CLAWME_TOKEN
```

3. 挂 MCP Server（零依赖，Node ≥ 18）：

```bash
claude mcp add clawme -- node /path/to/clawme-connector/mcp/clawme-mcp.mjs
```

MCP 宿主进程需要继承上述环境变量；持久配置按宿主文档设置。不要把真实 key 写入命令行参数或公开配置。

## 四个工具

- `clawme_notify` — 告诉人一件事，不等回复
- `clawme_ask` — 问一个问题并等回答；超时要按「没回答」处理，不是拒绝
- `clawme_action` — 备好卡片交给手机/浏览器执行
- `clawme_result` — 查卡片走到哪一步

## 直接 HTTP 调用

```
POST ${CLAWME_BASE_URL}/v1/instructions
Headers: Content-Type: application/json, X-ClawMe-Token: ${CLAWME_TOKEN}
Body: {"target":"browser|phone|any","instruction":{"type":"<type>","payload":{...}}}
GET  ${CLAWME_BASE_URL}/v1/instructions/:id   → 回执
```

常用类型：浏览器 `remind` / `open_url` / `compose_email` / `compose_tweet` / `fill_form` / `click` / `extract`；
iPhone `alert` / `draft_email` / `create_event` / `create_alarm` / `create_reminder` / `save_note` /
`share_social` / `phone_call` / `draft_sms` / `open_url` / `run_shortcut`。

类型发错不会被自动纠正：手机会显示「不支持的动作类型」。MCP Server 会在入队前挡掉。

## 回执口径

- 入队 ≠ 送达；送达 ≠ 人已处理；打开编辑器 ≠ 已发送。
- `handed_off` 是终态：目标 App 已接手，最后一步由人完成。
- 看不清的状态写 `unknown`，绝不填 0 或假装成功。

## 协议与许可

协议文档见 `docs/protocol.md`。本 Skill 与 MCP Server 为 MIT；ClawMe 服务端与客户端为专有软件。
