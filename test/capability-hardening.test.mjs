import test from "node:test";
import assert from "node:assert/strict";
import {
  signCapabilityGrant, verifyCapabilityGrant, loadVerifiedCapabilityGrants, resetCapabilityGrantCache,
  hashCapabilityArguments, signCapabilityApproval, verifyCapabilityApproval, generateApprovalKeyPair,
  signCapabilityApprovalEd25519, verifyCapabilityApprovalEd25519, createApprovalVerifier, isSafeResource,
} from "../src/agent/capability-grants.mjs";
import { createCapabilityRegistry } from "../src/agent/capability-registry.mjs";

const SECRET = "x".repeat(40);
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const grant = (o = {}) => ({
  subjectType: "app", subjectId: "contentcraft-app", appId: "contentcraft-app", capabilityId: "publish_post",
  operations: ["execute"], resourceScopes: ["blog/*"], maxCalls: 5, expiresAt: NOW + DAY, approvalRequired: false, ...o,
});
const layers = (o = {}) => [
  grant({ subjectType: "app", subjectId: "contentcraft-app", ...o }),
  grant({ subjectType: "caller", subjectId: "app_contentcraft-app", ...o }),
  grant({ subjectType: "agent", subjectId: "quality_engineer", ...o }),
  grant({ subjectType: "skill", subjectId: "write_post", ...o }),
];
const ctx = (o = {}) => ({ appId: "contentcraft-app", callerId: "app_contentcraft-app", agentId: "quality_engineer", skillId: "write_post", toolId: "publish_post", operation: "execute", resource: "blog/a", effectKey: "run-1:quality_engineer:1:publish_post", ...o });

test("grant: sign/verify roundtrip, forged signature rejected", async () => {
  const t = await signCapabilityGrant(grant(), SECRET, { now: NOW });
  assert.equal((await verifyCapabilityGrant(t, SECRET, { now: NOW })).ok, true);
  const forged = { ...t, payload: { ...t.payload, maxCalls: 9999 } };
  assert.equal((await verifyCapabilityGrant(forged, SECRET, { now: NOW })).code, "CAPABILITY_GRANT_SIGNATURE_INVALID");
});

test("grant: empty or unsafe scopes cannot be signed", async () => {
  for (const scopes of [[], ["../etc"], ["a/../b"], ["a%2e%2e/b"], ["a\\b"], [" a"]]) {
    await assert.rejects(() => signCapabilityGrant(grant({ resourceScopes: scopes }), SECRET, { now: NOW }), /INVALID_CAPABILITY_GRANT/);
  }
  assert.equal(isSafeResource("blog/post-1"), true);
  assert.equal(isSafeResource("blog/../x"), false);
});

test("loader: an expired signed grant is skipped, it no longer takes the gateway down", async () => {
  resetCapabilityGrantCache();
  const live = await signCapabilityGrant(grant(), SECRET, { now: NOW });
  const soon = await signCapabilityGrant(grant({ capabilityId: "other_tool", expiresAt: NOW + 1000 }), SECRET, { now: NOW });
  const env = { CAPABILITY_GRANTS_JSON: JSON.stringify([live, soon]), CAPABILITY_GRANT_SIGNING_KEY: SECRET };
  assert.equal((await loadVerifiedCapabilityGrants(env, { now: NOW })).length, 2);
  resetCapabilityGrantCache();
  const later = await loadVerifiedCapabilityGrants(env, { now: NOW + 5000 });
  assert.equal(later.length, 1);
  assert.equal(later[0].capabilityId, "publish_post");
});

test("loader: forged or malformed token still fails loudly; missing key fails", async () => {
  resetCapabilityGrantCache();
  const t = await signCapabilityGrant(grant(), SECRET, { now: NOW });
  const forged = { ...t, payload: { ...t.payload, maxCalls: 10000 } };
  await assert.rejects(() => loadVerifiedCapabilityGrants({ CAPABILITY_GRANTS_JSON: JSON.stringify([forged]), CAPABILITY_GRANT_SIGNING_KEY: SECRET }, { now: NOW }), /SIGNATURE_INVALID/);
  await assert.rejects(() => loadVerifiedCapabilityGrants({ CAPABILITY_GRANTS_JSON: JSON.stringify([t]) }, { now: NOW }), /SIGNING_KEY_REQUIRED/);
  await assert.rejects(() => loadVerifiedCapabilityGrants({ CAPABILITY_GRANTS_JSON: "{", CAPABILITY_GRANT_SIGNING_KEY: SECRET }, { now: NOW }), /CONFIG_INVALID/);
  assert.deepEqual(await loadVerifiedCapabilityGrants({}, { now: NOW }), []);
});

test("loader: cached result is reused and callers cannot poison the cache", async () => {
  resetCapabilityGrantCache();
  const t = await signCapabilityGrant(grant(), SECRET, { now: NOW });
  const env = { CAPABILITY_GRANTS_JSON: JSON.stringify([t]), CAPABILITY_GRANT_SIGNING_KEY: SECRET };
  const a = await loadVerifiedCapabilityGrants(env, { now: NOW });
  a.length = 0;
  const b = await loadVerifiedCapabilityGrants(env, { now: NOW });
  assert.equal(b.length, 1);
  assert.throws(() => { b[0].operations.push("delete"); }, TypeError);
  const changed = { ...env, CAPABILITY_GRANT_SIGNING_KEY: "y".repeat(40) };
  await assert.rejects(() => loadVerifiedCapabilityGrants(changed, { now: NOW }), /SIGNATURE_INVALID/);
});

test("arguments digest is key-order independent and rejects non-plain values", async () => {
  assert.equal(await hashCapabilityArguments({ a: 1, b: [1, 2] }), await hashCapabilityArguments({ b: [1, 2], a: 1 }));
  assert.notEqual(await hashCapabilityArguments({ a: 1 }), await hashCapabilityArguments({ a: 2 }));
  await assert.rejects(() => hashCapabilityArguments({ a: undefined }), /INVALID_CAPABILITY_ARGUMENTS/);
  await assert.rejects(() => hashCapabilityArguments({ a: new Date() }), /INVALID_CAPABILITY_ARGUMENTS/);
});

const approvalPayload = async (o = {}) => ({
  approvalId: "appr_" + "a".repeat(20), appId: "contentcraft-app", callerId: "app_contentcraft-app", agentId: "quality_engineer",
  skillId: "write_post", toolId: "publish_post", operation: "execute", resource: "blog/a",
  argumentsDigest: await hashCapabilityArguments({ title: "x" }), effectKey: "run-1:quality_engineer:1:publish_post", expiresAt: NOW + 5 * 60_000, ...o,
});
const expectedFor = async (o = {}) => { const { approvalId, expiresAt, ...rest } = await approvalPayload(); return { ...rest, ...o }; };

test("approval V2 (Ed25519): valid, and bound to tool, arguments, resource, caller and expiry", async () => {
  const kp = await generateApprovalKeyPair();
  const token = await signCapabilityApprovalEd25519(await approvalPayload(), kp.privateKey, { now: NOW });
  assert.equal(await verifyCapabilityApprovalEd25519(token, kp.publicKey, await expectedFor(), { now: NOW }), true);
  const bad = [
    { toolId: "delete_post" }, { resource: "blog/b" }, { callerId: "app_other" }, { operation: "read" },
    { argumentsDigest: await hashCapabilityArguments({ title: "y" }) },
    { effectKey: "run-2:quality_engineer:1:publish_post" },
  ];
  for (const o of bad) assert.equal(await verifyCapabilityApprovalEd25519(token, kp.publicKey, await expectedFor(o), { now: NOW }), false, JSON.stringify(Object.keys(o)));
  assert.equal(await verifyCapabilityApprovalEd25519(token, kp.publicKey, await expectedFor(), { now: NOW + 6 * 60_000 }), false, "expired");
  const other = await generateApprovalKeyPair();
  assert.equal(await verifyCapabilityApprovalEd25519(token, other.publicKey, await expectedFor(), { now: NOW }), false, "wrong key");
  const tampered = { ...token, payload: { ...token.payload, approvalId: "appr_" + "b".repeat(20) } };
  assert.equal(await verifyCapabilityApprovalEd25519(tampered, kp.publicKey, await expectedFor(), { now: NOW }), false, "approvalId swap");
  assert.equal(await verifyCapabilityApprovalEd25519(token, kp.publicKey, { ...(await expectedFor()), argumentsDigest: undefined }, { now: NOW }), false);
});

test("approval verifier: HMAC (V1) approvals are refused unless explicitly allowed", async () => {
  const kp = await generateApprovalKeyPair();
  const v1 = await signCapabilityApproval(await approvalPayload(), SECRET, { now: NOW });
  const v2 = await signCapabilityApprovalEd25519(await approvalPayload(), kp.privateKey, { now: NOW });
  const exp = await expectedFor();
  const strict = createApprovalVerifier({ CAPABILITY_APPROVAL_PUBLIC_KEY: kp.publicKey, CAPABILITY_GRANT_SIGNING_KEY: SECRET }, { now: NOW });
  assert.equal(await strict(v2, exp), true);
  assert.equal(await strict(v1, exp), false);
  const legacy = createApprovalVerifier({ ALLOW_HMAC_APPROVALS: "true", CAPABILITY_GRANT_SIGNING_KEY: SECRET }, { now: NOW });
  assert.equal(await legacy(v1, exp), true);
  assert.equal(await createApprovalVerifier({}, { now: NOW })(v2, exp), false, "no public key configured");
  assert.equal(await verifyCapabilityApproval(v1, SECRET, exp, { now: NOW }), true, "V1 still verifies directly");
});

test("registry: deny by default, all four layers needed", () => {
  const full = createCapabilityRegistry({ grants: layers(), now: () => NOW });
  assert.equal(full.resolve(ctx()).ok, true);
  for (let i = 0; i < 4; i++) {
    const missing = layers().filter((_, j) => j !== i);
    assert.equal(createCapabilityRegistry({ grants: missing, now: () => NOW }).resolve(ctx()).code, "CAPABILITY_NOT_GRANTED");
  }
  assert.equal(full.resolve(ctx({ appId: "rankgeo-app" })).code, "CAPABILITY_NOT_GRANTED", "app isolation");
});

test("registry: empty scopes no longer mean 'any resource'; legacy needs an explicit option", () => {
  const unscoped = layers({ resourceScopes: [] });
  assert.equal(createCapabilityRegistry({ grants: unscoped, now: () => NOW }).resolve(ctx()).code, "CAPABILITY_NOT_GRANTED");
  assert.equal(createCapabilityRegistry({ grants: unscoped, now: () => NOW, allowUnscopedGrants: true }).resolve(ctx()).ok, true);
});

test("registry: scope matching and traversal resources", () => {
  const r = createCapabilityRegistry({ grants: layers({ resourceScopes: ["blog/*", "docs/*"] }), now: () => NOW });
  assert.equal(r.resolve(ctx({ resource: "blog/x/y" })).ok, true);
  assert.equal(r.resolve(ctx({ resource: "docs" })).ok, true);
  assert.equal(r.resolve(ctx({ resource: "docs/a" })).ok, true);
  assert.equal(r.resolve(ctx({ resource: "docsX" })).code, "CAPABILITY_NOT_GRANTED");
  for (const bad of ["blog/../secrets", "blog/%2e%2e/x", "blog\\x", "blog/\u0000"]) {
    assert.equal(r.resolve(ctx({ resource: bad })).code, "INVALID_CAPABILITY_REQUEST", bad);
  }
});

test("registry.authorize: signed approval id, digest binding, audit on denial", async () => {
  const kp = await generateApprovalKeyPair();
  const sent = [];
  const authority = { authorize: async (x) => { sent.push(x); return { ok: true }; } };
  const events = [];
  const reg = createCapabilityRegistry({
    grants: layers({ approvalRequired: true }), now: () => NOW, authority, audit: { record: (e) => events.push(e) },
    verifyApproval: (t, e) => verifyCapabilityApprovalEd25519(t, kp.publicKey, e, { now: NOW }),
  });
  const digest = await hashCapabilityArguments({ title: "x" });
  const token = await signCapabilityApprovalEd25519(await approvalPayload({ argumentsDigest: digest }), kp.privateKey, { now: NOW });

  assert.equal((await reg.authorize({ ...ctx(), argumentsDigest: digest })).code, "CAPABILITY_APPROVAL_REQUIRED", "no approval");
  const otherDigest = await hashCapabilityArguments({ title: "changed after approval" });
  assert.equal((await reg.authorize({ ...ctx(), argumentsDigest: otherDigest, approval: token })).code, "CAPABILITY_APPROVAL_REQUIRED", "arguments changed");
  assert.equal(sent.length, 0, "authority never reached without a valid approval");

  // a caller-supplied top-level approvalId is not accepted: extra fields invalidate the token
  const spoofed = { ...token, approvalId: "appr_" + "z".repeat(20) };
  assert.equal((await reg.authorize({ ...ctx(), argumentsDigest: digest, approval: spoofed })).code, "CAPABILITY_APPROVAL_REQUIRED");
  assert.equal(sent.length, 0);
  const ok = await reg.authorize({ ...ctx(), argumentsDigest: digest, approval: token });
  assert.equal(ok.ok, true);
  assert.equal(sent[0].approvalId, token.payload.approvalId, "the ID forwarded to the DO is the SIGNED one");
  assert.equal(sent[0].maxCalls, 5);
  assert.equal(sent[0].effectKey, ctx().effectKey);
  assert.ok(events.filter((e) => e.type === "capability_denied").length >= 3, "denials are audited");
});

test("registry.authorize: authority failures fail closed", async () => {
  const mk = (authority) => createCapabilityRegistry({ grants: layers(), now: () => NOW, authority });
  assert.equal((await mk({ authorize: async () => { throw new Error("down"); } }).authorize(ctx())).code, "CAPABILITY_AUTHORITY_UNAVAILABLE");
  assert.equal((await mk({ authorize: async () => ({}) }).authorize(ctx())).code, "CAPABILITY_AUTHORITY_INVALID_RESPONSE");
  assert.equal((await mk({ authorize: async () => ({ ok: false, code: "CAPABILITY_QUOTA_EXCEEDED" }) }).authorize(ctx())).code, "CAPABILITY_QUOTA_EXCEEDED");
  assert.equal((await createCapabilityRegistry({ grants: layers(), now: () => NOW }).authorize(ctx())).code, "CAPABILITY_AUTHORITY_REQUIRED");
});