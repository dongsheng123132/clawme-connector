#!/usr/bin/env node
/**
 * clawme mcp —— 把 ClawMe 暴露成一个标准 MCP Server（stdio，换行分隔 JSON-RPC 2.0）。
 *
 * 为什么是它：ClawMe 的入口不该只属于 OpenClaw。任何支持 MCP 的客户端
 * （Claude Code / Codex / Cursor / DSH / 自研 agent）配一行命令就能用：
 *
 *   claude mcp add clawme -- node /path/to/scripts/clawme-mcp.mjs
 *
 * 四个工具就是全部语义，不随功能增长而膨胀：
 *   clawme_notify  告诉人一件事（不需要决定）
 *   clawme_ask     问人一个问题并等回答（阻塞、带回结果）
 *   clawme_action  备好一张可执行卡片，交给人/浏览器执行
 *   clawme_result  查一张卡片的真实状态
 *
 * 诚实原则：入队不等于送达，送达不等于人已处理，打开编辑器不等于已发送。
 * 工具返回值只报能观测到的事实，看不清就写 unknown，绝不填 0 或假装成功。
 *
 * 环境变量：CLAWME_BASE_URL（默认 http://127.0.0.1:31871）、CLAWME_TOKEN
 * 依赖：无。只用 Node 内置模块。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const DEFAULT_PROTOCOL = "2024-11-05";
const MAX_WAIT_SECONDS = 600;

const base = (process.env.CLAWME_BASE_URL || "http://127.0.0.1:31871").replace(/\/+$/, "");
const token = process.env.CLAWME_TOKEN || "";

const TARGETS = ["browser", "phone", "any"];

/**
 * 各端真正认识的指令类型（以客户端代码为准，不是猜的）：
 * iOS `InstructionType` 只有 alert / draft_email / create_event / create_alarm /
 * create_reminder / save_note / share_social / phone_call / draft_sms / open_url / run_shortcut；
 * Chrome 扩展认 remind / open_url / compose_tweet / compose_email / fill_form / click /
 * extract / add_calendar / upload_file / form_scan。
 *
 * 发错类型不会报错，只会让手机显示「不支持的动作类型」然后永远不回来 —— 所以在这里
 * fail-closed，把错误挡在入队之前。
 */
const PHONE_TYPES = new Set([
  "alert", "draft_email", "create_event", "create_alarm", "create_reminder",
  "save_note", "share_social", "phone_call", "draft_sms", "open_url", "run_shortcut",
]);
const BROWSER_TYPES = new Set([
  "remind", "open_url", "compose_tweet", "compose_email", "fill_form", "click",
  "extract", "add_calendar", "upload_file", "form_scan",
]);

function typeSupport(type, target) {
  if (target === "phone") return PHONE_TYPES.has(type) ? null : `phone 端不认识 ${type}`;
  if (target === "browser") return BROWSER_TYPES.has(type) ? null : `browser 端不认识 ${type}`;
  // target=any：至少有一端认识才允许入队
  if (PHONE_TYPES.has(type) || BROWSER_TYPES.has(type)) return null;
  return `没有任何端认识 ${type}`;
}

function log(...parts) {
  // stderr 只给诊断，stdout 专属协议流，混进去客户端会解析失败。
  console.error("[clawme-mcp]", ...parts);
}

async function relay(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-ClawMe-Token": token,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: response.ok, status: response.status, body };
}

function textResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function requireToken() {
  if (!token) {
    return textResult({
      ok: false,
      error: "not_configured",
      hint: "设置 CLAWME_TOKEN（可在 ~/.clawme.env 里）与 CLAWME_BASE_URL，再让客户端重启这个 MCP Server。",
    }, { isError: true });
  }
  return null;
}

/* ------------------------------- tools ------------------------------- */

const tools = [
  {
    name: "clawme_notify",
    description:
      "告诉用户一件事，不等待回复。适合：任务完成、执行失败、需要用户知道但不需要他决策的状态。"
      + "返回 queued 只代表已入队，不代表已送达或已被看到。",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "要给人看的一句话（简洁、可执行）" },
        title: { type: "string", description: "可选标题；不填则按动作类型自动生成" },
        target: { type: "string", enum: TARGETS, description: "送到哪个端，默认 phone" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "clawme_ask",
    description:
      "问用户一个问题并等他作决定（阻塞）。适合：要不要发布、选哪个方案、是否继续。"
      + "返回 confirmed / rejected / ignored / timeout — timeout 表示没人理，不是拒绝。",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "要问的问题，一句话说清选项差别" },
        title: { type: "string", description: "可选标题" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "可选：给出的选项文本，仅用于展示；确认/拒绝仍由客户端按钮表达",
        },
        timeout_seconds: {
          type: "number",
          description: `最多等多久（默认 180，上限 ${MAX_WAIT_SECONDS}）`,
          minimum: 5,
          maximum: MAX_WAIT_SECONDS,
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "clawme_action",
    description:
      "备好一张可执行卡片交给用户的设备：浏览器负责在当前登录态里打开/填写内容页，iPhone 负责原生动作。"
      + "返回 queued 与 id；动作最终是否完成要用 clawme_result 查。",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "动作类型，如 compose_email / compose_tweet / fill_form / open_url / remind / add_calendar",
        },
        payload: { type: "object", description: "该动作的字段，随 type 而定", additionalProperties: true },
        target: { type: "string", enum: TARGETS, description: "哪个端执行，默认 browser" },
        id: { type: "string", description: "可选幂等 id；重试时带同一个 id 不会重复打扰人" },
      },
      required: ["type", "payload"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "clawme_result",
    description:
      "查一张卡片的真实状态。状态语义：pending 未处理 / handed_off 已交给页面或系统界面但最后一下要人做 / "
      + "ok 观测到确实完成 / failed / cancelled。看不出结果时不会编造成功。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "clawme_action 或 clawme_ask 返回的 id" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
];

async function createInstruction({ type, payload, target, id }) {
  const missing = requireToken();
  if (missing) return missing;
  const unsupported = typeSupport(type, target);
  if (unsupported) {
    return textResult({
      ok: false,
      error: "unsupported_type_for_target",
      detail: unsupported,
      hint: target === "phone"
        ? "手机端只认 alert / draft_email / create_event / create_alarm / create_reminder / save_note / share_social / phone_call / draft_sms / open_url / run_shortcut。"
        : "浏览器端只认 remind / open_url / compose_email / compose_tweet / fill_form / click / extract / add_calendar / upload_file / form_scan。",
    }, { isError: true });
  }
  const instructionId = id || `mcp-${randomUUID()}`;
  const res = await relay("/v1/instructions", {
    method: "POST",
    body: JSON.stringify({ id: instructionId, target, instruction: { type, payload }, meta: { from: "mcp" } }),
  });
  if (!res.ok) {
    return textResult(
      { ok: false, delivered: "unknown", httpStatus: res.status, error: res.body },
      { isError: true },
    );
  }
  return textResult({
    ok: true,
    id: instructionId,
    status: res.body.status ?? "pending",
    // 说清楚这一层能证明什么：入队 ≠ 送达 ≠ 已被看到。
    delivered: "unknown",
    note: "已入队。这不代表手机已收到或人已看到；要确认进展请用 clawme_result 查状态。",
  });
}

async function readInstruction(id) {
  const missing = requireToken();
  if (missing) return missing;
  const res = await relay(`/v1/instructions/${encodeURIComponent(id)}`);
  if (res.status === 404) {
    return textResult({ ok: false, error: "not_found", id }, { isError: true });
  }
  if (!res.ok) {
    return textResult({ ok: false, error: res.body, httpStatus: res.status }, { isError: true });
  }
  const inst = res.body.instruction ?? {};
  return textResult({
    ok: true,
    id,
    status: inst.status ?? "unknown",
    result: inst.result ?? null,
    delivery: inst.delivery ?? null,
    resolvedAt: inst.resolvedAt ?? null,
  });
}

async function callNotify(args) {
  const target = args.target ?? "phone";
  // iPhone 的 InstructionType 里没有 remind，只有 alert；发错只会显示「不支持」。
  const type = target === "browser" ? "remind" : "alert";
  return createInstruction({
    type,
    payload: { message: args.message, ...(args.title ? { title: args.title } : {}) },
    target,
  });
}

async function callAction(args) {
  const target = args.target ?? "browser";
  return createInstruction({ type: args.type, payload: args.payload ?? {}, target, id: args.id });
}

async function callAsk(args) {
  const missing = requireToken();
  if (missing) return missing;
  const timeoutSeconds = Math.min(Number(args.timeout_seconds) || 180, MAX_WAIT_SECONDS);
  const id = `mcp-ask-${randomUUID()}`;
  const payload = { message: args.question, expect_reply: true };
  if (args.title) payload.title = args.title;
  if (Array.isArray(args.options) && args.options.length) payload.options = args.options;
  const created = await relay("/v1/instructions", {
    method: "POST",
    body: JSON.stringify({ id, target: "phone", instruction: { type: "alert", payload }, meta: { from: "mcp" } }),
  });
  if (!created.ok) {
    return textResult({ ok: false, decided: "unknown", httpStatus: created.status, error: created.body }, { isError: true });
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let status = created.body.status ?? "pending";
  let result = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    const poll = await relay(`/v1/instructions/${encodeURIComponent(id)}`);
    if (!poll.ok) continue;
    const inst = poll.body.instruction ?? {};
    status = inst.status ?? status;
    result = inst.result ?? result;
    if (status !== "pending") break;
  }

  const decided = status === "ok" ? "confirmed"
    : status === "cancelled" ? "rejected"
      : status === "failed" ? "failed"
        : status === "handed_off" ? "handed_off"
          : "timeout";
  return textResult({
    ok: decided === "confirmed",
    id,
    decided,
    // timeout 不是拒绝：没人看见这件事，别把它当答案用。
    note: decided === "timeout" ? `等了 ${timeoutSeconds} 秒没人处理；这不是拒绝，是不能当结论。` : undefined,
    result,
  });
}

const handlers = {
  clawme_notify: callNotify,
  clawme_ask: callAsk,
  clawme_action: callAction,
  clawme_result: (args) => readInstruction(args.id),
};

/* ------------------------------ JSON-RPC ------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return ok(id, {
        protocolVersion: typeof requested === "string" && requested ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "clawme", version: "0.1.0" },
        instructions:
          "ClawMe 把 AI 的请求转成用户设备上的一次人工确认。"
          + "入队不等于送达，送达不等于人已处理；不要用 ok 之外的状态声称动作已完成。",
      });
    }
    case "notifications/initialized":
    case "initialized":
      return; // 通知没有响应
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools });
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const handler = handlers[name];
      if (!handler) return fail(id, -32602, `unknown tool: ${name}`);
      try {
        const result = await handler(args);
        return ok(id, result);
      } catch (error) {
        log(`tool ${name} threw: ${error?.message}`);
        return ok(id, textResult({ ok: false, error: "internal_error", message: String(error?.message ?? error) }, { isError: true }));
      }
    }
    default:
      if (isNotification) return; // 未知通知按规范忽略
      return fail(id, -32601, `method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      continue;
    }
    void handle(message).catch((error) => {
      log(`handler failed: ${error?.message}`);
      fail(message?.id ?? null, -32603, "internal error");
    });
  }
});

process.stdin.on("end", () => process.exit(0));

// 启动自检只写 stderr：stdout 一旦混入非 JSON 内容，客户端整条连接都会废掉。
if (!token) {
  log("⚠️ 没有 CLAWME_TOKEN：工具调用会返回 not_configured，而不是假装成功。");
}
log(`relay=${base} tools=${tools.map((t) => t.name).join(",")}`);
