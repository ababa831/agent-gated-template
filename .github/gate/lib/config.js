'use strict';

const fs = require('node:fs');
const { compileTrusted } = require('./regexp');

const isTier = (v) => Number.isInteger(v) && v >= 0 && v <= 3;
const BOT_TYPES = ['review', 'check', 'status'];

function fail(message) {
  throw new Error(`risk-tiers.json: ${message}`);
}

function checkRegExp(pattern, where) {
  try {
    compileTrusted(pattern);
  } catch (e) {
    fail(`${where} の正規表現が不正: ${pattern}`);
  }
}

function validateConfig(c) {
  if (c.version !== 1) fail('version は 1');
  if (!isTier(c.defaultTier)) fail('defaultTier は 0〜3');
  if (!Number.isInteger(c.autoMergeMaxTier) || c.autoMergeMaxTier < -1 || c.autoMergeMaxTier > 2) {
    fail('autoMergeMaxTier は -1〜2（Tier 3 は常に人間の承認が必要）');
  }
  if (!Array.isArray(c.rules)) fail('rules は配列');
  c.rules.forEach((r, i) => {
    if (typeof r.id !== 'string') fail(`rules[${i}].id は文字列`);
    if (!isTier(r.tier)) fail(`rules[${i}].tier は 0〜3`);
    if (!Array.isArray(r.paths) || r.paths.length === 0) fail(`rules[${i}].paths は空でない配列`);
  });
  (c.tests?.skipPatterns ?? []).forEach((p, i) => checkRegExp(p, `tests.skipPatterns[${i}]`));
  for (const [label, t] of Object.entries(c.raiseLabels ?? {})) {
    if (!isTier(t)) fail(`raiseLabels.${label} は 0〜3`);
  }
  if (!Array.isArray(c.humanApprovers) || c.humanApprovers.length === 0) {
    fail('humanApprovers が空だと Tier 3 を承認できない');
  }
  if (!Array.isArray(c.botReviewers)) fail('botReviewers は配列');
  c.botReviewers.forEach((b, i) => {
    if (!BOT_TYPES.includes(b.type)) fail(`botReviewers[${i}].type は ${BOT_TYPES.join(' / ')}`);
    if (b.type === 'review' && typeof b.login !== 'string') fail(`botReviewers[${i}].login が必要`);
    if (b.type === 'check') checkRegExp(b.namePattern, `botReviewers[${i}].namePattern`);
    if (b.type === 'status') checkRegExp(b.contextPattern, `botReviewers[${i}].contextPattern`);
  });
  return c;
}

function loadConfig(file) {
  return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { loadConfig, validateConfig };
