import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSerpBearResult } from '../src/integrations/serpbear-result.mjs';

test('normalizes keyword positions from a common data wrapper', () => {
  const r = normalizeSerpBearResult({data:[{keyword:'mushroom growing',domain:'example.com',position:4,checkedAt:'2026-10-27T10:00:00Z',token:'secret'}]});
  assert.equal(r.ok,true); assert.equal(r.count,1);
  assert.deepEqual(r.rows[0],{keyword:'mushroom growing',domain:'example.com',position:4,checkedAt:'2026-10-27T10:00:00.000Z',source:'SERPBEAR'});
  assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('accepts valid null/unranked positions and unix seconds', () => {
  const r=normalizeSerpBearResult([{keyword:'query',domain:'example.org',position:null,date:1793095200}]);
  assert.equal(r.ok,true); assert.equal(r.rows[0].position,null); assert.ok(r.rows[0].checkedAt);
});
test('rejects malformed, oversized and invalid reports safely', () => {
  assert.deepEqual(normalizeSerpBearResult('{'),{ok:false,code:'SERPBEAR_INVALID_JSON'});
  assert.deepEqual(normalizeSerpBearResult('x'.repeat(2_000_001)),{ok:false,code:'SERPBEAR_REPORT_TOO_LARGE'});
  for (const x of [null,1,[],{results:'bad'},'{"token":"secret"}']) {
    const r=normalizeSerpBearResult(x); if (x===[]) assert.equal(r.ok,false); else assert.equal(r.ok,false);
  }
});
test('drops malformed rows and rejects unreasonable position values', () => {
  const r=normalizeSerpBearResult([{keyword:'ok',domain:'example.com',position:1},{keyword:'bad',domain:'example.com',position:-1},null,{keyword:'',domain:'x'}]);
  assert.equal(r.count,1); assert.equal(r.rejectedRows,3);
});
test('caps row count and bounds user-controlled strings', () => {
  assert.deepEqual(normalizeSerpBearResult(Array.from({length:1001},()=>({keyword:'q',domain:'example.com',position:1}))),{ok:false,code:'SERPBEAR_TOO_MANY_ROWS'});
  const r=normalizeSerpBearResult([{keyword:'k'.repeat(300),domain:'example.com',position:1}]);
  assert.equal(r.rows[0].keyword.length,180);
});
