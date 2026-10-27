import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUmamiAggregate } from '../src/integrations/umami-result.mjs';

test('keeps aggregate counters and drops visitor-level or unknown fields',()=>{
 const r=normalizeUmamiAggregate({visitors:12,visits:15,pageviews:30,bounces:4,users:[{email:'private@example.com'}],token:'secret',startAt:'2026-10-01',endAt:'2026-10-27'});
 assert.equal(r.ok,true); assert.deepEqual(r.stats,{visitors:12,visits:15,pageviews:30,bounces:4});
 assert.equal(JSON.stringify(r).includes('private@example.com'),false); assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('normalizes aggregate breakdown rows',()=>{
 const r=normalizeUmamiAggregate({data:[{x:'/home',y:40},{name:'/about',value:12},{x:'bad',y:-1}]});
 assert.equal(r.ok,true); assert.deepEqual(r.rows,[{label:'/home',value:40},{label:'/about',value:12}]);
});
test('rejects invalid JSON, invalid shapes, empty data and oversized payloads',()=>{
 assert.deepEqual(normalizeUmamiAggregate('{'),{ok:false,code:'UMAMI_INVALID_JSON'});
 assert.deepEqual(normalizeUmamiAggregate('x'.repeat(2_000_001)),{ok:false,code:'UMAMI_REPORT_TOO_LARGE'});
 for(const x of [null,1,[],{}, {visitors:-1}, {users:[{id:'private'}]}]) assert.equal(normalizeUmamiAggregate(x).ok,false);
});
test('rejects too many rows and invalid numeric counters',()=>{
 assert.deepEqual(normalizeUmamiAggregate({data:Array.from({length:501},(_,i)=>({x:String(i),y:1}))}),{ok:false,code:'UMAMI_TOO_MANY_ROWS'});
 const r=normalizeUmamiAggregate({visitors:-1,visits:1.5,pageviews:5});
 assert.equal(r.ok,true); assert.deepEqual(r.stats,{pageviews:5});
});
test('sanitizes and bounds breakdown labels',()=>{
 const r=normalizeUmamiAggregate({data:[{x:'x'.repeat(300),y:1}]});
 assert.equal(r.rows[0].label.length,160);
});
