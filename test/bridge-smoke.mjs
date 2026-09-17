#!/usr/bin/env node
/**
 * Smoke test of the stdio bridge: spawns bin/clipcliper-mcp.js as an MCP client would,
 * lists the tools and calls get_transcript on a short public video (free mode unless
 * CLIPCLIPER_LICENSE_KEY is set). Env CLIPCLIPER_MCP_URL selects the endpoint.
 *
 *   node test/bridge-smoke.mjs [videoUrl]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "clipcliper-mcp.js");
const video = process.argv[2] || "https://youtu.be/jNQXAC9IVRw";

const client = new Client({ name: "bridge-smoke", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env: process.env }));
console.log("server:", client.getServerVersion(), "| instructions:", (client.getInstructions() || "").slice(0, 60) + "…");

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
if (tools.length !== 3) throw new Error(`expected 3 tools, got ${tools.length}`);

let res;
for (let i = 0; i < 40; i++) {
  res = await client.callTool(
    { name: "get_transcript", arguments: { url: video, format: "text", wait_seconds: 60 } },
    undefined,
    { timeout: 10 * 60_000, resetTimeoutOnProgress: true, onprogress: (p) => console.log("progress:", p.message ?? p.progress) },
  );
  if (res.isError) throw new Error(res.content?.[0]?.text);
  if (res.structuredContent?.status !== "processing") break;
  await new Promise((r) => setTimeout(r, 3000));
}
const sc = res.structuredContent;
console.log(`transcript: "${sc.title}" ${sc.duration_sec}s → ${String(sc.transcript).slice(0, 80)}…`);
await client.close();
console.log("BRIDGE SMOKE OK");
