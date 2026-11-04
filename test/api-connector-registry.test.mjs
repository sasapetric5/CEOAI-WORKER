import test from "node:test";
import assert from "node:assert/strict";
import { createAPIConnectorRegistry } from "../src/integrations/api-connector-registry.mjs";

const payload = { hits: [{ objectID: "1", title: "Queues", url: "https://example.com", author: "a", points: 8, num_comments: 2, secret: "do not leak" }], nbHits: 1, page: 0, token: "private" };
function fake(handler) { const calls=[]; return { calls, fetchImpl: async (url, options) => { calls.push({url,options}); return handler(url,options); } }; }

test("registry exposes one public read-only connector and only GET operations", () => {
  const r=createAPIConnectorRegistry({fetchImpl:async()=>Response.json(payload)});
  const [c]=r.list(); assert.equal(c.id,"hacker_news_algolia"); assert.equal(c.authentication,"none");
  assert.ok(c.operations.every(x=>x.method==="GET")); assert.equal(r.get("missing"),null);
});

test("search is pinned to the approved HTTPS origin/path and projects allowlisted fields", async () => {
  const f=fake(async(url,options)=>{const u=new URL(url); assert.equal(u.origin,"https://hn.algolia.com"); assert.equal(u.pathname,"/api/v1/search"); assert.equal(u.searchParams.get("query"),"Cloudflare Queues"); assert.equal(options.method,"GET"); assert.equal(options.redirect,"error"); assert.equal(options.body,undefined); assert.equal(options.headers.Authorization,undefined); return Response.json(payload);});
  const r=createAPIConnectorRegistry({fetchImpl:f.fetchImpl}); const result=await r.execute("hacker_news_algolia","search",{query:"Cloudflare Queues"});
  assert.equal(result.ok,true); assert.equal(result.records[0].id,"1"); assert.equal(result.records[0].title,"Queues");
  assert.equal(JSON.stringify(result).includes("do not leak"),false); assert.equal(JSON.stringify(result).includes("private"),false);
});

test("unknown, unsafe and excessive arguments fail before network access", async () => {
  const f=fake(async()=>Response.json(payload)); const r=createAPIConnectorRegistry({fetchImpl:f.fetchImpl});
  assert.equal((await r.execute("unknown","search",{query:"x"})).code,"CONNECTOR_NOT_FOUND");
  assert.equal((await r.execute("hacker_news_algolia","search",{})).code,"CONNECTOR_MISSING_ARGUMENT");
  assert.equal((await r.execute("hacker_news_algolia","search",{query:"x",url:"https://evil.example"})).code,"CONNECTOR_UNKNOWN_ARGUMENT");
  assert.equal((await r.execute("hacker_news_algolia","search",{query:"x",page:99})).code,"CONNECTOR_INVALID_ARGUMENT");
  assert.equal(f.calls.length,0);
});

test("date search uses a fixed GET path and bounded pagination", async () => {
  const f=fake(async(url)=>{assert.equal(new URL(url).pathname,"/api/v1/search_by_date"); assert.equal(new URL(url).searchParams.get("tags"),"story"); return Response.json({hits:[],nbHits:0,page:0});});
  const result=await createAPIConnectorRegistry({fetchImpl:f.fetchImpl}).execute("hacker_news_algolia","search_by_date",{tags:"story",page:1});
  assert.equal(result.ok,true); assert.equal(result.count,0);
});

test("maps rate limits and HTTP errors without exposing upstream bodies", async () => {
  const f=fake(async()=>new Response("private server trace",{status:429,headers:{"Retry-After":"90"}}));
  const result=await createAPIConnectorRegistry({fetchImpl:f.fetchImpl}).execute("hacker_news_algolia","search",{query:"x"});
  assert.deepEqual(result,{ok:false,code:"CONNECTOR_RATE_LIMITED",retryAfterSeconds:90});
  const e=fake(async()=>new Response("secret",{status:500}));
  const failed=await createAPIConnectorRegistry({fetchImpl:e.fetchImpl}).execute("hacker_news_algolia","search",{query:"x"});
  assert.deepEqual(failed,{ok:false,code:"CONNECTOR_HTTP_ERROR"}); assert.equal(JSON.stringify(failed).includes("secret"),false);
});

test("rejects invalid content type, JSON, oversized payloads and unsafe output shapes", async () => {
  const cases=[
    [async()=>new Response("html",{status:200,headers:{"Content-Type":"text/html"}}),"CONNECTOR_CONTENT_TYPE_REJECTED"],
    [async()=>new Response("not-json",{status:200,headers:{"Content-Type":"application/json"}}),"CONNECTOR_INVALID_RESPONSE"],
    [async()=>new Response(JSON.stringify({hits:[]}),{status:200,headers:{"Content-Type":"application/json","Content-Length":"20000"}}),"CONNECTOR_INVALID_RESPONSE"],
  ];
  for(const [handler,code] of cases){const f=fake(handler);const r=createAPIConnectorRegistry({fetchImpl:f.fetchImpl,maxResponseBytes:1024});assert.equal((await r.execute("hacker_news_algolia","search",{query:"x"})).code,code);}
  const f=fake(async()=>Response.json({hits:{}})); assert.equal((await createAPIConnectorRegistry({fetchImpl:f.fetchImpl}).execute("hacker_news_algolia","search",{query:"x"})).code,"CONNECTOR_INVALID_RESPONSE");
});

test("bounds timeouts and does not follow redirects", async () => {
  const timeout=fake(async()=>{const e=new Error("aborted");e.name="AbortError";throw e;});
  assert.equal((await createAPIConnectorRegistry({fetchImpl:timeout.fetchImpl}).execute("hacker_news_algolia","search",{query:"x"})).code,"CONNECTOR_TIMEOUT");
  const redirect=fake(async(_url,options)=>{assert.equal(options.redirect,"error");return new Response("",{status:302,headers:{Location:"https://evil.example"}});});
  const result=await createAPIConnectorRegistry({fetchImpl:redirect.fetchImpl}).execute("hacker_news_algolia","search",{query:"x"});
  assert.equal(result.ok,false); assert.equal(JSON.stringify(result).includes("evil.example"),false);
});
