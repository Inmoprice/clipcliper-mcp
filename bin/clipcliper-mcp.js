#!/usr/bin/env node
/**
 * clipcliper-mcp — stdio bridge to the hosted CLIPCLIPER MCP server (https://clipcliper.com/mcp).
 *
 * The heavy lifting (downloading the video, Whisper, the LLM) runs on CLIPCLIPER's servers;
 * this process only speaks MCP over stdio for clients that cannot call a remote URL directly
 * and forwards your license key as "Authorization: Bearer <key>".
 *
 *   CLIPCLIPER_LICENSE_KEY=<key> npx clipcliper-mcp
 *   npx clipcliper-mcp --key <key>
 *
 * Optional: CLIPCLIPER_MCP_URL to point at another endpoint (e.g. https://up.clipcliper.com/mcp).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  LoggingMessageNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("../package.json");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`clipcliper-mcp ${version}
Usage: clipcliper-mcp [--key <license key>] [--url <mcp endpoint>]
Env:   CLIPCLIPER_LICENSE_KEY, CLIPCLIPER_MCP_URL (default https://clipcliper.com/mcp)
Tools: get_transcript, get_chapters, suggest_clips — see https://github.com/Inmoprice/clipcliper-mcp
`);
  process.exit(0);
}
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};

const REMOTE = flag("--url") || process.env.CLIPCLIPER_MCP_URL || "https://clipcliper.com/mcp";
const KEY = (flag("--key") || process.env.CLIPCLIPER_LICENSE_KEY || "").trim();
/** A transcript of a long video can take minutes; the remote sends progress, which resets this. */
const CALL_TIMEOUT_MS = 11 * 60_000;

const log = (...m) => process.stderr.write(`[clipcliper-mcp] ${m.join(" ")}\n`);

async function main() {
  const remote = new Client({ name: "clipcliper-mcp-bridge", version });
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE), {
    requestInit: KEY ? { headers: { Authorization: `Bearer ${KEY}` } } : undefined,
  });
  try {
    await remote.connect(transport);
  } catch (err) {
    log(`cannot reach ${REMOTE}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const info = remote.getServerVersion();
  const instructions = remote.getInstructions();

  const local = new Server(
    { name: info?.name || "clipcliper", version: info?.version || version },
    { capabilities: { tools: {}, logging: {} }, instructions },
  );

  local.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());

  local.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const token = request.params._meta?.progressToken;
    return remote.callTool(request.params, undefined, {
      timeout: CALL_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      signal: extra.signal,
      onprogress: (p) => {
        if (token === undefined) return;
        void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, ...p } }).catch(() => {});
      },
    });
  });

  // Server → client log lines ("downloading", "transcribing 42 min of audio") pass through.
  remote.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    void local.notification(n).catch(() => {});
  });

  await local.connect(new StdioServerTransport());
  if (!KEY) log(`no license key: free mode (short videos, daily limit). Set CLIPCLIPER_LICENSE_KEY to use your hours.`);
}

main().catch((err) => {
  log(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
