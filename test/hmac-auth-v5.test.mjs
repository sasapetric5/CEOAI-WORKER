import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyHmacSignature } from "../src/v5-modules/hmac-auth.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const encoder = new TextEncoder();
const path = "/internal/complete";
const secret = "test-secret-contentcraft-app-32-bytes-minimum";
const body = encoder.encode(JSON.stringify({ action: "test" }));
const appId = "CONTENTCRAFT-APP";

class MockSecurityDO {
  used = new Set();
  async fetch(_url, options) {
    const value = JSON.parse(options.body);
    const key = value.appId + ":" + value.nonce;
    if (this.used.has(key)) return Response.json({ error: "Replay" }, { status: 409 });
    this.used.add(key);
    return Response.json({ success: true });
  }
}
function makeEnv(overrides = {}) {
  const durable = new MockSecurityDO();
  return {
    HMAC_ALLOWED_APPS: "CONTENTCRAFT-APP,AIFORCE-APP",
    APP_SECRET_CONTENTCRAFT_APP: secret,
    SECURITY_DO: { idFromName: name => name, get: () => durable },
    ...overrides
  };
}
async function sign({ method = "POST", requestPath = path, timestamp = String(Math.floor(Date.now()/1000)), nonce = "nonce_test_1234567890", payload = body, signingSecret = secret } = {}) {
  const hash = await crypto.subtle.digest("SHA-256", payload);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
  const canonical = [method, requestPath, timestamp, nonce, hex].join("\n");
  const key = await crypto.subtle.importKey("raw", encoder.encode(signingSecret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return Buffer.from(signature).toString("base64");
}
async function request({ nonce, timestamp, signature, payload = body, requestPath = path, method = "POST", env = makeEnv(), headers = {} } = {}) {
  nonce ??= "nonce_test_1234567890";
  timestamp ??= String(Math.floor(Date.now()/1000));
  signature ??= await sign({ nonce, timestamp, payload, requestPath, method });
  const req = new Request("https://ceoai.test" + requestPath, { method, headers: {
    "X-App-Id": appId, "X-Timestamp": timestamp, "X-Nonce": nonce, "X-Signature": signature, ...headers
  }});
  return verifyHmacSignature(req, payload, env);
}

test("accepts a correctly signed request and consumes its nonce", async () => {
  const env = makeEnv();
  const result = await request({ env, nonce: "nonce_valid_123456789" });
  assert.equal(result.valid, true);
  assert.equal(result.appId, appId);
});
test("rejects replayed nonce", async () => {
  const env = makeEnv(), nonce = "nonce_replay_123456789";
  assert.equal((await request({ env, nonce })).valid, true);
  const replay = await request({ env, nonce });
  assert.equal(replay.valid, false);
  assert.equal(replay.status, 401);
});
test("rejects a modified body, path, or method", async () => {
  const timestamp = String(Math.floor(Date.now()/1000)), nonce = "nonce_tamper_123456789";
  const signature = await sign({ timestamp, nonce });
  assert.equal((await request({ timestamp, nonce, signature, payload: encoder.encode("changed") })).status, 401);
  assert.equal((await request({ timestamp, nonce: "nonce_path_12345678901", signature, requestPath: "/other" })).status, 401);
  assert.equal((await request({ timestamp, nonce: "nonce_method_123456789", signature, method: "PUT" })).status, 401);
});
test("rejects missing or unapproved app identity", async () => {
  const env = makeEnv();
  const sig = await sign({ nonce: "nonce_unknown_123456789" });
  const req = new Request("https://ceoai.test" + path, { method:"POST", headers:{
    "X-Timestamp":String(Math.floor(Date.now()/1000)), "X-Nonce":"nonce_unknown_123456789", "X-Signature":sig, "X-App-Id":"UNKNOWN-APP"
  }});
  assert.equal((await verifyHmacSignature(req, body, env)).status, 401);
});
test("rejects stale and future timestamps", async () => {
  const old = String(Math.floor(Date.now()/1000)-600);
  const future = String(Math.floor(Date.now()/1000)+600);
  assert.equal((await request({ timestamp: old, nonce:"nonce_stale_123456789" })).status, 401);
  assert.equal((await request({ timestamp: future, nonce:"nonce_future_123456789" })).status, 401);
});
test("fails closed when secret or durable replay protection is unavailable", async () => {
  assert.equal((await request({ env:makeEnv({APP_SECRET_CONTENTCRAFT_APP:undefined}), nonce:"nonce_nosecret_123456789" })).status, 503);
  assert.equal((await request({ env:makeEnv({SECURITY_DO:null}), nonce:"nonce_nodo_123456789" })).status, 503);
});
test("maps replay-store outages to 503 and replay conflicts to 401", async () => {
  const outage = makeEnv({SECURITY_DO:{idFromName:()=> "x",get:()=>({fetch:async()=>new Response("down",{status:500})})}});
  assert.equal((await request({env:outage,nonce:"nonce_outage_123456789"})).status,503);
  const conflict = makeEnv({SECURITY_DO:{idFromName:()=> "x",get:()=>({fetch:async()=>new Response("replay",{status:409})})}});
  assert.equal((await request({env:conflict,nonce:"nonce_conflict_123456789"})).status,401);
});
test("accepts canonical base64url signatures", async () => {
  const nonce = "nonce_base64url_123456789";
  const standard = await sign({nonce});
  const urlSafe = standard.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  assert.equal((await request({nonce,signature:urlSafe})).valid,true);
});
test("rejects malformed nonce, signature and body buffer", async () => {
  assert.equal((await request({nonce:"short"})).status,401);
  assert.equal((await request({signature:"not-a-signature"})).status,401);
  const req = new Request("https://ceoai.test"+path,{method:"POST",headers:{
    "X-App-Id":appId,"X-Timestamp":String(Math.floor(Date.now()/1000)),"X-Nonce":"nonce_badbuffer_123456789"
  }});
  assert.equal((await verifyHmacSignature(req, {}, makeEnv())).status,401);
});

test("rejects query-string tampering because the full request target is signed", async () => {
  const nonce = "nonce_query_bind_123456789";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await sign({ nonce, timestamp, requestPath: path });
  const req = new Request("https://ceoai.test" + path + "?scope=admin", {
    method: "POST",
    headers: {
      "X-App-Id": appId,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
  });
  const result = await verifyHmacSignature(req, body, makeEnv());
  assert.equal(result.valid, false);
  assert.equal(result.status, 401);
});
