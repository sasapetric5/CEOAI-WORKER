import test from 'node:test';
import assert from 'node:assert/strict';
import { listIntegrationDefinitions, getIntegrationDefinition, getIntegrationReadiness } from '../src/integrations/registry.mjs';

const EXPECTED = ['lychee', 'unlighthouse', 'serpbear', 'umami', 'crawl4ai'];

test('registry declares exactly the five approved capabilities', () => {
  const definitions = listIntegrationDefinitions();
  assert.deepEqual(definitions.map((item) => item.id), EXPECTED);
  assert.equal(new Set(definitions.map((item) => item.id)).size, EXPECTED.length);
});

test('definitions are defensive copies and do not mutate registry state', () => {
  const first = getIntegrationDefinition('lychee');
  first.requires.push('malicious mutation');
  assert.equal(getIntegrationDefinition('lychee').requires.includes('malicious mutation'), false);
});

test('unknown integrations fail closed', () => {
  assert.deepEqual(getIntegrationReadiness('not-real', {}), { id: 'not-real', known: false, enabled: false, status: 'UNKNOWN_INTEGRATION' });
});

test('all integrations remain inactive with empty configuration', () => {
  for (const id of EXPECTED) {
    const status = getIntegrationReadiness(id, {});
    assert.equal(status.known, true);
    assert.equal(status.enabled, false);
    assert.equal(status.status, 'NOT_CONFIGURED');
    assert.equal(status.endpointConfigured, false);
    assert.equal(status.credentialConfigured, false);
  }
});

test('partial opt-in reports incomplete configuration without enabling a module', () => {
  const status = getIntegrationReadiness('crawl4ai', {
    CEOAI_CRAWL4AI_ENABLED: 'true',
    CEOAI_CRAWL4AI_URL: 'https://crawler.example.test',
  });
  assert.equal(status.status, 'INCOMPLETE_CONFIGURATION');
  assert.equal(status.enabled, false);
  assert.equal(status.credentialConfigured, false);
});

test('complete config is not misreported as implemented or enabled', () => {
  const status = getIntegrationReadiness('umami', {
    CEOAI_UMAMI_ENABLED: 'true',
    CEOAI_UMAMI_URL: 'https://analytics.example.test',
    CEOAI_UMAMI_TOKEN: 'do-not-return-this-token',
  });
  assert.equal(status.status, 'CONFIG_PRESENT_NOT_IMPLEMENTED');
  assert.equal(status.enabled, false);
  assert.equal(JSON.stringify(status).includes('do-not-return-this-token'), false);
  assert.equal(JSON.stringify(status).includes('analytics.example.test'), false);
});

test('status output never includes raw endpoint or credentials', () => {
  const status = getIntegrationReadiness('serpbear', {
    CEOAI_SERPBEAR_ENABLED: 'true',
    CEOAI_SERPBEAR_URL: 'https://rank.example.test/private',
    CEOAI_SERPBEAR_TOKEN: 'secret-value',
  });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('rank.example.test'), false);
  assert.equal(serialized.includes('secret-value'), false);
});
