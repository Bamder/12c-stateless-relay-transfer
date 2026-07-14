import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReceiveUrl,
  parseReceiveIntent,
} from '../src/qr-share-link.ts';
import {
  createQrSvg,
  QR_DOWNLOAD_FILENAME,
} from '../src/qr-share.ts';

test('buildReceiveUrl keeps HTTPS origin, port, and Registry base path', () => {
  const result = buildReceiveUrl(
    'https://registry.example:8443/services/registry?admin=hidden#old',
    'AbC-12xyZ-90',
  );

  assert.equal(
    result.url,
    'https://registry.example:8443/services/registry/#v=1&receive=AbC-12xyZ-90',
  );
  assert.deepEqual(result.warnings, []);
});

test('buildReceiveUrl never puts the credential in the query', () => {
  const credential = 'ABCDEF-12345';
  const result = buildReceiveUrl(
    'https://registry.example/base/?receive=stale&token=secret',
    credential,
  );
  const parsed = new URL(result.url);

  assert.equal(parsed.search, '');
  assert.equal(parsed.search.includes(credential), false);
  assert.equal(parsed.hash, `#v=1&receive=${credential}`);
});

test('buildReceiveUrl reports insecure and loopback URLs', () => {
  assert.deepEqual(
    buildReceiveUrl('http://localhost:8080', 'ABCDEF123456').warnings,
    ['insecure', 'loopback'],
  );
  assert.deepEqual(
    buildReceiveUrl('https://127.0.0.1', 'ABCDEF123456').warnings,
    ['loopback'],
  );
  assert.deepEqual(
    buildReceiveUrl('http://[::1]', 'ABCDEF123456').warnings,
    ['insecure', 'loopback'],
  );
  assert.deepEqual(
    buildReceiveUrl('https://localhost.', 'ABCDEF123456').warnings,
    ['loopback'],
  );
  assert.deepEqual(
    buildReceiveUrl('https://[::ffff:127.0.0.1]', 'ABCDEF123456').warnings,
    ['loopback'],
  );
});

test('buildReceiveUrl rejects non-HTTP(S) URLs and invalid credentials', () => {
  assert.throws(
    () => buildReceiveUrl('file:///app/index.html', 'ABCDEF123456'),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => buildReceiveUrl('registry.example', 'ABCDEF123456'),
    /absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () => buildReceiveUrl('https://registry.example', 'ABC_12345678'),
    /exactly 12/,
  );
});

test('buildReceiveUrl rejects Registry userinfo instead of sharing it', () => {
  assert.throws(
    () => buildReceiveUrl(
      'https://admin:secret@registry.example/base',
      'ABCDEF123456',
    ),
    /username or password/,
  );
  assert.throws(
    () => buildReceiveUrl(
      'https://admin@registry.example/base',
      'ABCDEF123456',
    ),
    /username or password/,
  );
});

test('QR SVG is generated locally with a credential-free export name', () => {
  const credential = 'ABCDEF123456';
  const svg = createQrSvg(
    `https://registry.example/#v=1&receive=${credential}`,
  );

  assert.match(svg, /^<svg\b/);
  assert.equal(svg.includes(credential), false);
  assert.equal(QR_DOWNLOAD_FILENAME, '12c-receive-qr.svg');
  assert.equal(QR_DOWNLOAD_FILENAME.includes(credential), false);
});

test('parseReceiveIntent accepts v1 mixed-case and hyphenated credentials', () => {
  assert.deepEqual(parseReceiveIntent('#v=1&receive=AbC-12xyZ-90'), {
    kind: 'valid',
    credential: 'AbC-12xyZ-90',
    autoDownload: true,
  });
});

test('parseReceiveIntent accepts legacy receive links without auto-download', () => {
  assert.deepEqual(parseReceiveIntent('#receive=ABCDEF-12345'), {
    kind: 'valid',
    credential: 'ABCDEF-12345',
    autoDownload: false,
  });
});

test('parseReceiveIntent returns none for an empty fragment', () => {
  assert.deepEqual(parseReceiveIntent(''), { kind: 'none' });
  assert.deepEqual(parseReceiveIntent('#'), { kind: 'none' });
});

test('parseReceiveIntent rejects duplicate v or receive parameters', () => {
  assert.equal(
    parseReceiveIntent('#v=1&v=1&receive=ABCDEF123456').kind,
    'invalid',
  );
  assert.equal(
    parseReceiveIntent('#v=1&receive=ABCDEF123456&receive=ABCDEF123456').kind,
    'invalid',
  );
});

test('parseReceiveIntent rejects unsupported versions and unexpected parameters', () => {
  assert.deepEqual(parseReceiveIntent('#v=2&receive=ABCDEF123456'), {
    kind: 'invalid',
    reason: 'unsupported-version',
  });
  assert.deepEqual(parseReceiveIntent('#v=1&receive=ABCDEF123456&ttl=60'), {
    kind: 'invalid',
    reason: 'unexpected-parameter',
  });
  assert.deepEqual(parseReceiveIntent('#other=value'), {
    kind: 'invalid',
    reason: 'unexpected-parameter',
  });
});

test('parseReceiveIntent rejects missing and malformed credentials', () => {
  assert.deepEqual(parseReceiveIntent('#v=1'), {
    kind: 'invalid',
    reason: 'missing-credential',
  });
  for (const hash of [
    '#v=1&receive=',
    '#v=1&receive=TOO-SHORT',
    '#v=1&receive=ABC_DEF12345',
    '#receive=ABCDEFGHIJKLM',
  ]) {
    assert.equal(parseReceiveIntent(hash).kind, 'invalid', hash);
  }
});
