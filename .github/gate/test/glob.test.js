'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesGlob, matchesAny } = require('../lib/glob');

test('`*` はディレクトリ区切りをまたがない', () => {
  assert.equal(matchesGlob('Makefile', 'Makefile'), true);
  assert.equal(matchesGlob('tsconfig.json', 'tsconfig*.json'), true);
  assert.equal(matchesGlob('tsconfig.build.json', 'tsconfig*.json'), true);
  assert.equal(matchesGlob('packages/a/tsconfig.json', 'tsconfig*.json'), false);
});

test('`**/` は0個以上のディレクトリに一致する', () => {
  assert.equal(matchesGlob('package.json', '**/package.json'), true);
  assert.equal(matchesGlob('apps/web/package.json', '**/package.json'), true);
  assert.equal(matchesGlob('apps/web/package.json.bak', '**/package.json'), false);
});

test('末尾の `/**` は配下すべてに一致する', () => {
  assert.equal(matchesGlob('.github/workflows/ci.yml', '.github/**'), true);
  assert.equal(matchesGlob('.github/CODEOWNERS', '.github/**'), true);
  assert.equal(matchesGlob('.githubx/a', '.github/**'), false);
});

test('途中の `**` と `?` を扱える', () => {
  assert.equal(matchesGlob('src/a/b/auth/login.ts', 'src/**/auth/*.ts'), true);
  assert.equal(matchesGlob('src/auth/login.ts', 'src/**/auth/*.ts'), true);
  assert.equal(matchesGlob('a1.md', 'a?.md'), true);
  assert.equal(matchesGlob('a/1.md', 'a?.md'), false);
});

test('正規表現の記号はリテラルとして扱う', () => {
  assert.equal(matchesGlob('a+b.txt', 'a+b.txt'), true);
  assert.equal(matchesGlob('aab.txt', 'a+b.txt'), false);
  assert.equal(matchesGlob('requirements-dev.txt', '**/requirements*.txt'), true);
});

test('matchesAny はいずれかのパターンに一致すれば true', () => {
  assert.equal(matchesAny('docs/a.md', ['src/**', 'docs/**']), true);
  assert.equal(matchesAny('lib/a.js', ['src/**', 'docs/**']), false);
  assert.equal(matchesAny('lib/a.js', []), false);
});
