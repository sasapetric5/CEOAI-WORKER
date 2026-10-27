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
    CEOAI_CRAWL4AI_URL: 'https://crawler.example.com',
  });
  assert.equal(status.status, 'INCOMPLETE_CONFIGURATION');
  assert.equal(status.enabled, false);
  assert.equal(status.credentialConfigured, false);
});

test('complete config is not misreported as implemented or enabled', () => {
  const status = getIntegrationReadiness('umami', {
    CEOAI_UMAMI_ENABLED: 'true',
    CEOAI_UMAMI_URL: 'https://analytics.example.com',
    CEOAI_UMAMI_TOKEN: 'do-not-return-this-token',
  });
  assert.equal(status.status, 'CONFIG_PRESENT_NOT_IMPLEMENTED');
  assert.equal(status.enabled, false);
  assert.equal(JSON.stringify(status).includes('do-not-return-this-token'), false);
  assert.equal(JSON.stringify(status).includes('analytics.example.com'), false);
});

test('status output never includes raw endpoint or credentials', () => {
  const status = getIntegrationReadiness('serpbear', {
    CEOAI_SERPBEAR_ENABLED: 'true',
    CEOAI_SERPBEAR_URL: 'https://rank.example.com/private',
    CEOAI_SERPBEAR_TOKEN: 'secret-value',
  });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('rank.example.com'), false);
  assert.equal(serialized.includes('secret-value'), false);
});

test('unsafe endpoints are rejected: HTTP, credentials, IP literals, private names and non-default ports', () => {
  const invalid = [
    'http://runner.example.com',
    'https://user:pass@runner.example.com',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://localhost',
    'https://runner.local',
    'https://runner.internal',
    'https://runner.example.test',
    'https://runner.example.com:8443',
    'https://runner.example.com/?token=secret',
  ];
  for (const endpoint of invalid) {
    const status = getIntegrationReadiness('lychee', {
      CEOAI_LYCHEE_ENABLED: 'true',
      CEOAI_LYCHEE_URL: endpoint,
      CEOAI_LYCHEE_TOKEN: 'test-token',
    });
    assert.equal(status.endpointConfigured, false, endpoint);
    assert.equal(status.enabled, false, endpoint);
    assert.equal(status.status, 'INCOMPLETE_CONFIGURATION', endpoint);
  }
});

test('only HTTPS service URLs with public-looking hostnames pass basic syntax checks', () => {
  for (const id of EXPECTED) {
    const prefix = 'CEOAI_' + id.toUpperCase();
    const status = getIntegrationReadiness(id, {
      [prefix + '_ENABLED']: 'true',
      [prefix + '_URL']: 'https://service.example.com/api',
      [prefix + '_TOKEN']: 'test-token',
    });
    assert.equal(status.endpointConfigured, true, id);
    assert.equal(status.enabled, false, id);
    assert.equal(status.status, 'CONFIG_PRESENT_NOT_IMPLEMENTED', id);
  }
});

test('malformed, ambiguous and alternate IP endpoint forms fail closed', () => {
  const invalid = [
    'https://service..example.com',
    'https://-service.example.com',
    'https://service-.example.com',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://2130706433',
    'https://0x7f000001',
    'https://metadata.google.internal',
    'https://service.example.com/path?access_token=private',
    'https://service.example.com/path#fragment',
  ];
  for (const endpoint of invalid) {
    const status = getIntegrationReadiness('crawl4ai', {
      CEOAI_CRAWL4AI_ENABLED: 'true',
      CEOAI_CRAWL4AI_URL: endpoint,
      CEOAI_CRAWL4AI_TOKEN: 'never-return-this',
    });
    assert.equal(status.endpointConfigured, false, endpoint);
    assert.equal(status.enabled, false, endpoint);
    assert.equal(JSON.stringify(status).includes('never-return-this'), false);
  }
});

test('case variants and truthy non-boolean values do not opt in integrations', () => {
  for (const value of ['TRUE', '1', 'yes', true, 1, ' true ']) {
    const status = getIntegrationReadiness('lychee', {
      CEOAI_LYCHEE_ENABLED: value,
      CEOAI_LYCHEE_URL: 'https://service.example.com/api',
      CEOAI_LYCHEE_TOKEN: 'test-token',
    });
    assert.equal(status.status, 'NOT_CONFIGURED', String(value));
    assert.equal(status.enabled, false, String(value));
  }
});
