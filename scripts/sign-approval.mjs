#!/usr/bin/env node
// Owner-side tool. Runs on YOUR machine; the private key never goes into the Worker.
//   node scripts/sign-approval.mjs --gen                      -> new Ed25519 key pair
//   APPROVAL_PRIVATE_KEY=<pkcs8 b64url> node scripts/sign-approval.mjs request.json
// request.json: { appId, callerId, agentId, skillId, toolId, operation, resource, arguments, ttlMinutes? }
// The approval is bound to exactly these values, including a digest of `arguments`, and lives at most 10 minutes.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { generateApprovalKeyPair, signCapabilityApprovalEd25519, hashCapabilityArguments } from "../src/agent/capability-grants.mjs";

const arg = process.argv[2];
if (arg === "--gen") {
  const kp = await generateApprovalKeyPair();
  console.log(JSON.stringify({
    CAPABILITY_APPROVAL_PUBLIC_KEY: kp.publicKey + "   <- put in the Worker (wrangler secret / var)",
    APPROVAL_PRIVATE_KEY: kp.privateKey + "   <- keep OFFLINE, never in the Worker or the repo",
  }, null, 2));
  process.exit(0);
}
const priv = process.env.APPROVAL_PRIVATE_KEY;
if (!arg || !priv) { console.error("usage: APPROVAL_PRIVATE_KEY=... node scripts/sign-approval.mjs request.json | --gen"); process.exit(2); }
const r = JSON.parse(readFileSync(arg, "utf8"));
const ttl = Math.min(Math.max(Number(r.ttlMinutes ?? 5), 1), 10);
const payload = {
  approvalId: "appr_" + randomBytes(16).toString("hex"),
  appId: r.appId, callerId: r.callerId, agentId: r.agentId, skillId: r.skillId, toolId: r.toolId,
  operation: r.operation ?? "execute", resource: r.resource ?? "",
  argumentsDigest: await hashCapabilityArguments(r.arguments ?? {}),
  expiresAt: Date.now() + ttl * 60_000,
};
console.error(`APPROVING: ${payload.toolId}/${payload.operation} on "${payload.resource}" for ${payload.appId}/${payload.agentId}/${payload.skillId}`);
console.error(`arguments: ${JSON.stringify(r.arguments ?? {})}`);
console.error(`valid ${ttl} min, single use, id ${payload.approvalId}`);
console.log(JSON.stringify(await signCapabilityApprovalEd25519(payload, priv)));