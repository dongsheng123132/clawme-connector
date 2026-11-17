# ClawMe 接入协议（稳定契约）

本文件只描述**怎么连**，不描述服务端实现。服务端可以自建，也可以接官方托管 `https://relay.clawme.net`。

## 鉴权

- Header：`X-ClawMe-Token: <key>`（也接受 `Authorization: Bearer <key>`）
- 没有配置任何凭据时，relay 一律拒绝（fail-closed）。
- `key` 就是账号；没有邮箱、没有找回邮件。丢了 key 只能换一把，旧数据不自动迁移。

## 入队一条动作

```
POST /v1/instructions
Content-Type: application/json
X-ClawMe-Token: <key>

{
  "id": "可选，幂等键；同 id 重复提交返回原动作",
  "target": "browser | phone | any",
  "instruction": { "type": "<type>", "payload": { ... } },
  "meta": { "workflow_id": "可选" }
}
```

响应 `201` + 动作对象。重复 id 返回原动作，不会重复推送、不会重复计配额。

## 查回执

```
GET /v1/instructions/:id
X-ClawMe-Token: <key>
```

回执阶段（保守口径）：

| 状态 | 含义 |
|---|---|
| `queued` | 已入队，不代表设备收到 |
| `delivered` | 客户端确实收到了卡片 |
| `handed_off` | 已交给浏览器页面 / iOS 原生 App，最后一步由人完成 |
| `ok` | 只用于能直接观测到完成的结果 |

MCP 工具在无法确认时返回 `delivered: "unknown"`；`handed_off` 不能被当成「已发送」。

## 动作类型

浏览器：`remind`、`open_url`、`compose_email`、`compose_tweet`、`fill_form`、`click`、`extract`、
`add_calendar`、`upload_file`、`form_scan`。

iPhone：`alert`、`draft_email`、`create_event`、`create_alarm`、`create_reminder`、`save_note`、
`share_social`、`phone_call`、`draft_sms`、`open_url`、`run_shortcut`。

类型与端不匹配会被 MCP Server 在入队前拒绝；直接走 HTTP 的用户会看到「不支持的动作类型」。

## 配额与错误

- 免费档默认 **5 条新动作 / 租户 / 天**（环境变量 `CLAWME_DAILY_LIMIT` 可调；自建可设 0 不限）。
- 只算新入队动作；查状态、收结果、同 id 重试不计数。
- 超限返回 `429 daily_limit_reached`，带 `used` / `limit` / `resetInSeconds`。
- 单条动作体积上限 256KB，超出返回 `413`。

## 变更纪律

四个工具名与回执语义固定，不随功能增长膨胀。新增类型只加 payload，不改工具契约。
