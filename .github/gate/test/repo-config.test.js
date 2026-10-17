'use strict';

// リポジトリ自身の設定ファイルの整合性を検査する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../lib/config');
const { classifyTier } = require('../lib/classify');

const root = path.resolve(__dirname, '../../..');
const config = loadConfig(path.join(root, '.github/risk-tiers.json'));

const codeownersPatterns = () =>
  fs
    .readFileSync(path.join(root, '.github/CODEOWNERS'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0].replace(/^\//, ''));

test('risk-tiers.json は検証を通る', () => {
  assert.ok(config.rules.length > 0);
});

test('CODEOWNERS と gate-integrity ルールのパスが一致している', () => {
  const rule = config.rules.find((r) => r.id === 'gate-integrity');
  assert.ok(rule, 'gate-integrity ルールが必要');
  assert.deepEqual([...codeownersPatterns()].sort(), [...rule.paths].sort());
});

test('skipPatterns は主要言語の skip 記法を検出し、通常のテストは検出しない', () => {
  const res = config.tests.skipPatterns.map((p) => new RegExp(p));
  const hit = (line) => res.some((re) => re.test(line));
  for (const line of [
    "it.skip('a', () => {})",
    "describe.skip('a', () => {})",
    "test.todo('a')",
    "xit('a', () => {})",
    '@pytest.mark.skip(reason="x")',
    '@pytest.mark.xfail',
    'pytest.skip("x")',
    '@unittest.skip("x")',
    't.Skip("flaky")',
    '#[ignore]',
    '@Disabled',
    'throw XCTSkip("x")',
  ]) {
    assert.equal(hit(line), true, line);
  }
  for (const line of ["it('skips empty input', () => {})", 'const skipped = items.filter(isSkipped)']) {
    assert.equal(hit(line), false, line);
  }
});

test('ゲートを支えるファイルの変更は Tier 3 になる', () => {
  for (const filename of [
    '.github/workflows/ci.yml',
    '.github/workflows/gate.yml',
    '.github/gate/lib/evaluate.js',
    '.github/risk-tiers.json',
    '.github/CODEOWNERS',
    'AGENTS.md',
    'src/AGENTS.md',
    'packages/web/CLAUDE.md',
    '.cursor/BUGBOT.md',
    'src/BUGBOT.md',
    'Makefile',
    'GNUmakefile',
    'makefile',
    '.semgrepignore',
    '.gitleaksignore',
  ]) {
    const r = classifyTier(
      { files: [{ filename, status: 'modified', additions: 1, deletions: 0, patch: '+x' }], labels: [], author: 'agent[bot]' },
      config,
    );
    assert.equal(r.tier, 3, filename);
  }
});
