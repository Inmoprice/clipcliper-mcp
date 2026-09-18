#!/usr/bin/env node
/**
 * Publishes server.json to the official MCP Registry using HTTP domain authentication
 * (https://modelcontextprotocol.io/registry/authentication): the public half of an Ed25519 key is
 * served at https://clipcliper.com/.well-known/mcp-registry-auth and this script signs a timestamp
 * with the private half. No third-party login involved; the namespace is com.clipcliper/*.
 *
 *   MCP_REGISTRY_KEY=/path/to/key.pem node scripts/publish-registry.mjs [--dry-run]
 *
 * The private key never lives in this repository.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = process.env.MCP_REGISTRY_URL || "https://registry.modelcontextprotocol.io";
const DOMAIN = "clipcliper.com";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = process.env.MCP_REGISTRY_KEY;
if (!keyPath) {
  console.error("Set MCP_REGISTRY_KEY to the Ed25519 private key (PEM) whose public half is at /.well-known/mcp-registry-auth");
  process.exit(1);
}
const server = JSON.parse(fs.readFileSync(path.join(root, "server.json"), "utf8"));
if (server.description.length > 100) throw new Error(`description is ${server.description.length} chars (registry limit: 100)`);
if (!server.name.startsWith("com.clipcliper/")) throw new Error("domain auth only allows names under com.clipcliper/");

// The proof the registry will check must already be live and match this key.
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
const publicB64 = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const hosted = (await (await fetch(`https://${DOMAIN}/.well-known/mcp-registry-auth`)).text()).trim();
if (!hosted.includes(`p=${publicB64}`)) throw new Error(`hosted proof does not match this key: ${hosted}`);
console.log("proof OK:", hosted);

if (process.argv.includes("--dry-run")) {
  console.log("dry run: would publish", server.name, server.version);
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const signed = crypto.sign(null, Buffer.from(timestamp), privateKey).toString("hex");
const auth = await fetch(`${REGISTRY}/v0/auth/http`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ domain: DOMAIN, timestamp, signed_timestamp: signed }),
});
const authBody = await auth.json().catch(() => ({}));
if (!auth.ok || !authBody.registry_token) {
  console.error("auth failed:", auth.status, JSON.stringify(authBody).slice(0, 500));
  process.exit(2);
}
console.log("authenticated as", DOMAIN);

const pub = await fetch(`${REGISTRY}/v0/publish`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${authBody.registry_token}` },
  body: JSON.stringify(server),
});
const pubBody = await pub.text();
console.log("publish:", pub.status, pubBody.slice(0, 800));
process.exit(pub.ok ? 0 : 3);
