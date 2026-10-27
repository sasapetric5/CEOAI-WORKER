import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLycheeReport } from '../src/integrations/lychee-result.mjs';
import { normalizeUnlighthouseReport } from '../src/integrations/unlighthouse-result.mjs';
import { normalizeSerpBearResult } from '../src/integrations/serpbear-result.mjs';
import { normalizeUmamiAggregate } from '../src/integrations/umami-result.mjs';
import { normalizeCrawl4AIResult } from '../src/integrations/crawl4ai-result.mjs';

const JSON_LIMIT = 5_000_000;

test('all five normalizers reject malformed JSON with stable errors', () => {
  assert.equal(normalizeLycheeReport('{secret').code, 'LYCHEE_REPORT_INVALID_JSON');
  assert.equal(normalizeUnlighthouseReport('{secret').code, 'UNLIGHTHOUSE_REPORT_INVALID_JSON');
  assert.equal(normalizeSerpBearResult('{secret').code, 'SERPBEAR_INVALID_JSON');
  assert.equal(normalizeUmamiAggregate('{secret').code, 'UMAMI_INVALID_JSON');
  assert.equal(normalizeCrawl4AIResult('{secret').code, 'CRAWL4AI_INVALID_JSON');
});

test('all five normalizers reject oversized serialized payloads before parsing', () => {
  const large = 'x'.repeat(JSON_LIMIT + 1);
  assert.equal(normalizeLycheeReport(large).code, 'LYCHEE_REPORT_TOO_LARGE');
  assert.equal(normalizeUnlighthouseReport(large).code, 'UNLIGHTHOUSE_REPORT_TOO_LARGE');
  assert.equal(normalizeSerpBearResult(large).code, 'SERPBEAR_REPORT_TOO_LARGE');
  assert.equal(normalizeUmamiAggregate(large).code, 'UMAMI_REPORT_TOO_LARGE');
  assert.equal(normalizeCrawl4AIResult(large).code, 'CRAWL4AI_RESULT_TOO_LARGE');
});

test('normalizers never echo arbitrary secret-like upstream fields', () => {
  const secret = 'Bearer super-secret-token';
  const lychee = normalizeLycheeReport({ fail_map: { 'https://example.com/?token=abc': [{ url:'https://example.com/path?api_key=abc', message:secret, unexpected:secret }] } });
  const lighthouse = normalizeUnlighthouseReport({ requestedUrl:'https://example.com/?token=abc', categories:{performance:{score:0.9}}, audits:{'largest-contentful-paint':{numericValue:500}}, token:secret, stack:secret });
  const serp = normalizeSerpBearResult([{keyword:'hello',domain:'example.com',position:1,token:secret}]);
  const umami = normalizeUmamiAggregate({data:{visitors:5,token:secret,visitorsList:[secret]}});
  const crawl = normalizeCrawl4AIResult({url:'https://example.com/?token=abc',markdown:'hello',token:secret,private:secret});
  const named = { lychee, lighthouse, serp, umami, crawl };
  for (const [name, result] of Object.entries(named)) {
    assert.equal(JSON.stringify(result).includes(secret), false, name + ' leaked upstream secret');
    assert.equal(JSON.stringify(result).includes('token=abc'), false, name + ' leaked URL token');
    assert.equal(JSON.stringify(result).includes('api_key=abc'), false, name + ' leaked URL API key');
  }
});

test('URL-bearing normalizers strip query and fragment from valid HTTP URLs', () => {
  const lychee = normalizeLycheeReport({fail_map:{x:[{url:'https://example.com/a?session=123#private'}]}});
  assert.equal(lychee.failures[0].url, 'https://example.com/a');
  const lighthouse = normalizeUnlighthouseReport({requestedUrl:'https://example.com/a?session=123#private',categories:{seo:{score:1}},audits:{'first-contentful-paint':{numericValue:123}}});
  assert.equal(lighthouse.requestedUrl, 'https://example.com/a');
  const crawl = normalizeCrawl4AIResult({url:'https://example.com/a?session=123#private',markdown:'content'});
  assert.equal(crawl.url, 'https://example.com/a');
});

test('Crawl4AI rejects script, file, credential-bearing and malformed URLs', () => {
  for (const url of ['javascript:alert(1)','file:///etc/passwd','https://user:pass@example.com','not a URL','data:text/html,hello']) {
    const result = normalizeCrawl4AIResult({url,markdown:'content'});
    assert.equal(result.ok, false, url);
    assert.equal(JSON.stringify(result).includes(url), false);
  }
});

test('SerpBear rejects malformed rows and bounds row counts', () => {
  const mixed = normalizeSerpBearResult([
    {keyword:'valid',domain:'example.com',position:3},
    {keyword:'invalid',domain:'example.com',position:-1},
    null,
    {keyword:'missing domain',position:1}
  ]);
  assert.equal(mixed.ok, true);
  assert.equal(mixed.count, 1);
  assert.equal(mixed.rejectedRows, 3);
  assert.equal(normalizeSerpBearResult(Array.from({length:1001},(_,i)=>({keyword:String(i),domain:'example.com',position:1}))).code, 'SERPBEAR_TOO_MANY_ROWS');
});

test('Umami rejects invalid counters and caps aggregate rows', () => {
  const result = normalizeUmamiAggregate({data:{visitors:-1,visits:2.5,pageviews:4,rows:[]}});
  assert.equal(result.ok, true);
  assert.deepEqual(result.stats, {pageviews:4});
  assert.equal(normalizeUmamiAggregate({data:{rows:Array.from({length:501},(_,i)=>({x:String(i),y:1}))}}).code, 'UMAMI_TOO_MANY_ROWS');
});

test('Lychee caps returned failures and records truncation without raw objects', () => {
  const fail_map = { group: Array.from({length:8},(_,i)=>({url:'https://example.com/'+i,message:'x'.repeat(500),raw:{secret:'private'}})) };
  const result = normalizeLycheeReport({fail_map},{maxFailures:3});
  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 3);
  assert.equal(result.summary.truncatedFailures, 5);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('Lighthouse score and metric values stay within safe numeric bounds', () => {
  const result = normalizeUnlighthouseReport({
    categories:{performance:{score:9},accessibility:{score:-1},seo:{score:0.75}},
    audits:{'largest-contentful-paint':{numericValue:-10,score:2},'first-contentful-paint':{numericValue:123.456,score:0.5}}
  });
  assert.equal(result.ok, true);
  assert.equal(result.categories.performance.score, null);
  assert.equal(result.categories.accessibility.score, null);
  assert.equal(result.categories.seo.score, 75);
  assert.equal(result.metrics['largest-contentful-paint'].numericValue, null);
  assert.equal(result.metrics['largest-contentful-paint'].score, null);
  assert.equal(result.metrics['first-contentful-paint'].numericValue, 123.46);
});

test('each normalizer returns a bounded stable error for invalid top-level shapes', () => {
  assert.equal(normalizeLycheeReport([]).code, 'LYCHEE_REPORT_INVALID_SHAPE');
  assert.equal(normalizeUnlighthouseReport([]).code, 'UNLIGHTHOUSE_REPORT_INVALID_SHAPE');
  assert.equal(normalizeSerpBearResult({}).code, 'SERPBEAR_INVALID_SHAPE');
  assert.equal(normalizeUmamiAggregate([]).code, 'UMAMI_INVALID_SHAPE');
  assert.equal(normalizeCrawl4AIResult([]).code, 'CRAWL4AI_INVALID_SHAPE');
});
