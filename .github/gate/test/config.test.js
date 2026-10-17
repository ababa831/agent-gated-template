'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../lib/config');

const valid = () => ({
  version: 1,
  defaultTier: 1,
  autoMergeMaxTier: -1,
  rules: [{ id: 'docs', tier: 0, paths: ['**/*.md'] }],
  tests: { paths: [], skipPatterns: [] },
  humanApprovers: ['owner'],
  botReviewers: [],
});

test('正しい設定は検証を通る', () => {
  assert.doesNotThrow(() => validateConfig(valid()));
});

test('Tier の範囲外は拒否する', () => {
  assert.throws(() => validateConfig({ ...valid(), defaultTier: 4 }), /defaultTier/);
  assert.throws(() => validateConfig({ ...valid(), autoMergeMaxTier: 3 }), /autoMergeMaxTier/);
  assert.throws(
    () => validateConfig({ ...valid(), rules: [{ id: 'x', tier: 5, paths: ['a'] }] }),
    /rules\[0\]\.tier/,
  );
});

test('humanApprovers が空なら Tier 3 を承認できないため拒否する', () => {
  assert.throws(() => validateConfig({ ...valid(), humanApprovers: [] }), /humanApprovers/);
});

test('不正な正規表現は拒否する', () => {
  assert.throws(
    () => validateConfig({ ...valid(), tests: { paths: [], skipPatterns: ['('] } }),
    /skipPatterns/,
  );
});

test('check 型・status 型のパターンが未定義や空文字なら拒否する（空の正規表現はすべてに一致するため）', () => {
  for (const bot of [
    { name: 'x', type: 'check' },
    { name: 'x', type: 'check', namePattern: '' },
    { name: 'x', type: 'check', pattern: 'bugbot' },
    { name: 'x', type: 'status' },
    { name: 'x', type: 'status', contextPattern: '' },
  ]) {
    assert.throws(() => validateConfig({ ...valid(), botReviewers: [bot] }), /botReviewers\[0\]/, JSON.stringify(bot));
  }
});

test('未知のボット種別は拒否する', () => {
  assert.throws(
    () => validateConfig({ ...valid(), botReviewers: [{ name: 'x', type: 'magic' }] }),
    /botReviewers\[0\]\.type/,
  );
});
