'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTier } = require('../lib/classify');

const config = {
  defaultTier: 1,
  rules: [
    { id: 'gate-integrity', tier: 3, paths: ['.github/**', 'AGENTS.md'] },
    {
      id: 'dependency-manifests',
      tier: 3,
      paths: ['**/package.json'],
      exceptAuthors: ['dependabot[bot]'],
    },
    { id: 'public-release', tier: 3, enabled: false, paths: ['**/auth/**'] },
    { id: 'docs', tier: 0, paths: ['**/*.md', 'docs/**'] },
    { id: 'tests', tier: 0, paths: ['tests/**', '**/*.test.*'] },
  ],
  tests: {
    paths: ['tests/**', '**/*.test.*'],
    skipPatterns: ['\\.skip\\(', '@pytest\\.mark\\.skip'],
  },
  raiseLabels: { 'risk:tier2': 2, 'risk:tier3': 3 },
  maxChangedLines: 400,
  sizeExclude: ['**/*.lock', '**/package-lock.json'],
  sizeExemptLabel: 'size:exempt',
};

const file = (filename, extra = {}) => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 0,
  patch: '@@ -1 +1 @@\n+x',
  ...extra,
});

const classify = (files, pr = {}) =>
  classifyTier({ files, labels: [], author: 'agent[bot]', ...pr }, config);

test('ドキュメントだけの変更は Tier 0', () => {
  const r = classify([file('README.md'), file('docs/guide.txt')]);
  assert.equal(r.tier, 0);
});

test('どのルールにも一致しないファイルは defaultTier', () => {
  const r = classify([file('README.md'), file('src/app.ts')]);
  assert.equal(r.tier, 1);
});

test('複数ルールに一致するファイルは高い方の Tier を取る（AGENTS.md は md だが Tier 3）', () => {
  const r = classify([file('AGENTS.md')]);
  assert.equal(r.tier, 3);
  assert.ok(r.reasons.some((x) => x.includes('gate-integrity')));
});

test('ゲートや CI の設定変更は Tier 3', () => {
  assert.equal(classify([file('.github/workflows/ci.yml')]).tier, 3);
});

test('リネーム元のパスも判定に含める', () => {
  const r = classify([
    file('src/workflows.yml', { status: 'renamed', previous_filename: '.github/workflows/ci.yml' }),
  ]);
  assert.equal(r.tier, 3);
});

test('依存マニフェストの変更は Tier 3、ただし除外された作者なら対象外', () => {
  assert.equal(classify([file('apps/web/package.json')]).tier, 3);
  assert.equal(classify([file('apps/web/package.json')], { author: 'dependabot[bot]' }).tier, 1);
});

test('enabled: false のルールは無視する', () => {
  assert.equal(classify([file('src/auth/login.ts')]).tier, 1);
});

test('テストファイルの削除は Tier 3', () => {
  const r = classify([file('tests/a.test.ts', { status: 'removed' })]);
  assert.equal(r.tier, 3);
  assert.ok(r.reasons.some((x) => x.includes('削除')));
});

test('テストに skip を追加すると Tier 3', () => {
  const r = classify([
    file('tests/a.test.ts', { patch: '@@ -1,2 +1,2 @@\n-it("a", f)\n+it.skip("a", f)' }),
  ]);
  assert.equal(r.tier, 3);
});

test('skip を削除する変更は Tier 3 にしない', () => {
  const r = classify([
    file('tests/a.test.ts', { patch: '@@ -1 +1 @@\n-it.skip("a", f)\n+it("a", f)' }),
  ]);
  assert.equal(r.tier, 0);
});

test('差分を取得できないテストファイルの変更は検査できないため Tier 3', () => {
  const r = classify([file('tests/a.test.ts', { patch: undefined })]);
  assert.equal(r.tier, 3);
});

test('ラベルは Tier を引き上げるだけで、引き下げない', () => {
  assert.equal(classify([file('README.md')], { labels: ['risk:tier2'] }).tier, 2);
  assert.equal(classify([file('AGENTS.md')], { labels: ['risk:tier2'] }).tier, 3);
});

test('変更行数の上限超過は sizeExceeded を立てる（除外パターンは数えない）', () => {
  const big = file('src/a.ts', { additions: 300, deletions: 150 });
  assert.equal(classify([big]).sizeExceeded, true);
  const lock = file('package-lock.json', { additions: 5000 });
  assert.equal(classify([file('src/a.ts'), lock]).sizeExceeded, false);
});

test('size:exempt ラベルがあれば上限超過を許すが Tier 3 にする', () => {
  const big = file('src/a.ts', { additions: 500 });
  const r = classify([big], { labels: ['size:exempt'] });
  assert.equal(r.sizeExceeded, false);
  assert.equal(r.tier, 3);
});

test('ファイル一覧が API の上限で切り捨てられた場合は Tier 3', () => {
  const r = classify([file('src/a.ts')], { filesTruncated: true });
  assert.equal(r.tier, 3);
});

test('変更ファイルがなければ Tier 0', () => {
  assert.equal(classify([]).tier, 0);
});
