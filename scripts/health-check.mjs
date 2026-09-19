#!/usr/bin/env node
/**
 * External health probe for a hosted CLIPCLIPER MCP endpoint. It does what a directory health
 * check does: open an MCP connection (`initialize`) and list the tools (`tools/list`), over plain
 * Streamable HTTP. Zero dependencies (Node 18+), so the scheduled workflow needs no install step.
 *
 *   node scripts/health-check.mjs <mcp-url> [--attempts N] [--gap-seconds S] [--wait-first] [--timeout-ms MS]
 *
 * Prints one JSON line per attempt. Exit code 0 = some attempt was healthy, 1 = every attempt failed,
 * 2 = bad usage. In GitHub Actions it also writes a job summary line and an error annotation.
 */
import fs from "node:fs";

const EXPECTED_SERVER = "clipcliper";
const EXPECTED_TOOLS = ["get_transcript", "get_chapters", "suggest_clips"];
const USER_AGENT = "clipcliper-health/1.0 (+https://github.com/Inmoprice/clipcliper-mcp)";

function parseArgs(argv) {
  const out = { url: "", attempts: 1, gapSeconds: 20, waitFirst: false, timeoutMs: 30_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--attempts") out.attempts = Number(argv[++i]);
    else if (a === "--gap-seconds") out.gapSeconds = Number(argv[++i]);
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--wait-first") out.waitFirst = true;
    else if (!a.startsWith("--") && !out.url) out.url = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!/^https?:\/\//.test(out.url)) throw new Error("first argument must be the MCP endpoint URL");
  for (const k of ["attempts", "gapSeconds", "timeoutMs"]) {
    if (!Number.isFinite(out[k]) || out[k] < 0) throw new Error(`invalid --${k}`);
  }
  out.attempts = Math.max(1, Math.floor(out.attempts));
  return out;
}

class ProbeError extends Error {
  constructor(stage, message, extra = {}) {
    super(message);
    this.stage = stage;
    this.extra = extra;
  }
}

/** Cloudflare data centre that served the request ("a3d4…-MIA" → "MIA"); null when not behind Cloudflare. */
function coloOf(res) {
  const ray = res.headers.get("cf-ray") || "";
  const m = ray.match(/-([A-Z]{3})$/);
  return m ? m[1] : null;
}

/** One JSON-RPC call over Streamable HTTP. The server answers either JSON or a one-message SSE stream. */
async function rpc(url, stage, body, timeoutMs) {
  const t0 = performance.now();
  let res;
  let text;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    text = await res.text();
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const why = err?.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : err?.cause?.code || err?.cause?.message || err?.message || String(err);
    throw new ProbeError(stage, `network: ${why}`, { ms });
  }
  const ms = Math.round(performance.now() - t0);
  const colo = coloOf(res);
  if (res.status >= 300 && res.status < 400) {
    throw new ProbeError(stage, `HTTP ${res.status} redirect to ${res.headers.get("location") || "?"}`, { ms, colo, status: res.status });
  }
  if (!res.ok) throw new ProbeError(stage, `HTTP ${res.status}`, { ms, colo, status: res.status });

  let message = null;
  const type = res.headers.get("content-type") || "";
  try {
    if (type.includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed && parsed.id === body.id) message = parsed;
      }
    } else {
      message = JSON.parse(text);
    }
  } catch {
    throw new ProbeError(stage, "unparseable response", { ms, colo });
  }
  if (!message) throw new ProbeError(stage, "no JSON-RPC response in the body", { ms, colo });
  if (message.error) throw new ProbeError(stage, `JSON-RPC error ${message.error.code}: ${String(message.error.message).slice(0, 120)}`, { ms, colo });
  return { result: message.result, ms, colo };
}

async function probeOnce(url, timeoutMs) {
  const init = await rpc(
    url,
    "initialize",
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "clipcliper-health", version: "1.0.0" } } },
    timeoutMs,
  );
  const name = init.result?.serverInfo?.name;
  if (name !== EXPECTED_SERVER) throw new ProbeError("initialize", `unexpected server name: ${JSON.stringify(name)}`, { ms: init.ms, colo: init.colo });

  const list = await rpc(url, "tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list" }, timeoutMs);
  const tools = Array.isArray(list.result?.tools) ? list.result.tools.map((t) => t.name) : [];
  const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length) throw new ProbeError("tools/list", `missing tools: ${missing.join(", ")}`, { ms: list.ms, colo: list.colo });
  return { ms: { initialize: init.ms, tools_list: list.ms }, colo: list.colo || init.colo, tools: tools.length };
}

function appendSummary(line) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, line + "\n");
  } catch {
    // The summary is a nicety; never fail the probe over it.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(String(err.message || err));
  process.exit(2);
}

let lastError = "";
for (let attempt = 1; attempt <= opts.attempts; attempt++) {
  if (attempt > 1 || opts.waitFirst) await sleep(opts.gapSeconds * 1000);
  const at = new Date().toISOString();
  try {
    const ok = await probeOnce(opts.url, opts.timeoutMs);
    console.log(JSON.stringify({ at, url: opts.url, attempt, ok: true, ...ok }));
    appendSummary(`- ✅ \`${opts.url}\` attempt ${attempt}: initialize ${ok.ms.initialize} ms, tools/list ${ok.ms.tools_list} ms, ${ok.tools} tools${ok.colo ? `, Cloudflare ${ok.colo}` : ""}`);
    process.exit(0);
  } catch (err) {
    const stage = err instanceof ProbeError ? err.stage : "probe";
    const extra = err instanceof ProbeError ? err.extra : {};
    lastError = `${stage}: ${err.message}${extra.colo ? ` (Cloudflare ${extra.colo})` : ""}`;
    console.log(JSON.stringify({ at, url: opts.url, attempt, ok: false, stage, error: err.message, ...extra }));
    appendSummary(`- ❌ \`${opts.url}\` attempt ${attempt}: ${lastError}${extra.ms != null ? ` after ${extra.ms} ms` : ""}`);
  }
}
if (process.env.GITHUB_ACTIONS) console.log(`::error title=MCP endpoint unhealthy::${opts.url} ${lastError}`);
process.exit(1);
