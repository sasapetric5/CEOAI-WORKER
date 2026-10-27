import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCrawl4AIResult } from '../src/integrations/crawl4ai-result.mjs';
const fixture=()=>({success:true,url:'https://example.com/page?token=secret#section',markdown:'# Hello\nContent',metadata:{title:'Example',description:'A page',private:'do-not-return'},links:[{href:'https://example.com/next?private=1',text:'Next'},{href:'javascript:alert(1)',text:'bad'}],media:{images:[{src:'https://example.com/a.png'}]},cookies:[{value:'secret-cookie'}],content_type:'text/markdown'});
test('normalizes bounded markdown, metadata, links and image URLs',()=>{
 const r=normalizeCrawl4AIResult(fixture()); assert.equal(r.ok,true); assert.equal(r.url,'https://example.com/page'); assert.equal(r.content,'# Hello\nContent');
 assert.deepEqual(r.links,[{url:'https://example.com/next',text:'Next'}]); assert.deepEqual(r.images,['https://example.com/a.png']);
 for(const secret of ['secret','private','do-not-return','cookies'])assert.equal(JSON.stringify(r).includes(secret),false);
});
test('accepts array-wrapped results and HTML content',()=>{
 const r=normalizeCrawl4AIResult([{url:'https://example.org',html:'<h1>Hi</h1>'}]); assert.equal(r.ok,true); assert.equal(r.content,'<h1>Hi</h1>');
});
test('rejects invalid, failed, empty, credential-bearing and non-web results',()=>{
 for(const x of [null,1,[],{},'{','x'.repeat(5_000_001),{success:false},{url:'https://example.com',markdown:' '},{url:'file:///etc/passwd',markdown:'x'},{url:'https://u:p@example.com',markdown:'x'}]) assert.equal(normalizeCrawl4AIResult(x).ok,false);
});
test('caps extraction content and metadata',()=>{
 const r=normalizeCrawl4AIResult({url:'https://example.com',markdown:'x'.repeat(210_000),metadata:{title:'t'.repeat(900)},links:Array.from({length:120},(_,i)=>({url:'https://example.com/'+i}))});
 assert.equal(r.content.length,200_000); assert.equal(r.metadata.title.length,500); assert.equal(r.links.length,100);
});
test('drops malformed links and strips control characters',()=>{
 const r=normalizeCrawl4AIResult({url:'https://example.com',markdown:'a\u0000b',links:[null,{url:'ftp://example.com'}]});
 assert.equal(r.content,'ab'); assert.deepEqual(r.links,[]);
});
