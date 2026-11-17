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

成功响应为 `201`。同一租户内，相同 id 且目标和动作内容一致的重试返回已有动作，不重复推送和计数；内容不同会返回 `409 id_conflict`。

## 查回执

```
GET /v1/instructions/:id
X-ClawMe-Token: <key>
```

回执阶段（保守口径）：

| 状态 | 含义 |
|---|---|
| `pending` | 已入队等待处理，不代表设备收到 |
| `handed_off` | 已交给浏览器页面或系统界面，后续由人操作 |
| `ok` | 客户端报告已完成；具体能观测到什么取决于动作类型 |
| `failed` / `cancelled` | 客户端报告失败 / 用户取消 |

MCP 工具在无法确认时返回 `delivered: "unknown"`；`handed_off` 不能被当成「已发送」。

## 动作类型

浏览器：`remind`、`open_url`、`compose_email`、`compose_tweet`、`fill_form`、`click`、`extract`、
`add_calendar`、`upload_file`、`form_scan`。

iPhone：`alert`、`draft_email`、`create_event`、`create_alarm`、`create_reminder`、`save_note`、
`share_social`、`phone_call`、`draft_sms`、`open_url`、`run_shortcut`。

类型与端不匹配会被 MCP Server 在入队前拒绝；直接走 HTTP 的用户会看到「不支持的动作类型」。

## 配额与错误

- 当前官方实例设置为每租户每日 5 条新入队动作；限制按 UTC 日期重置，计数在内存，服务重启会清零。目前没有持久计费或按租户付费分档。
- 只算新入队动作；查状态、收结果、同 id 重试不计数。
- 超限返回 `429 daily_limit_reached`，带 `used` / `limit` / `resetInSeconds`。
- 单条动作体积上限 256KB，超出返回 `413`。

## 变更纪律

四个工具名与回执语义固定，不随功能增长膨胀。新增类型只加 payload，不改工具契约。
