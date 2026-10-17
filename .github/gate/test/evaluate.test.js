'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGate } = require('../lib/evaluate');

const HEAD = 'head-sha';
const OLD = 'old-sha';

const config = {
  autoMergeMaxTier: 2,
  humanApprovers: ['owner'],
  featureFlag: { trailer: 'Feature-Flag' },
  botReviewers: [
    {
      name: 'CodeRabbit',
      type: 'review',
      login: 'coderabbitai[bot]',
      acceptStates: ['APPROVED'],
      minTier: 1,
      rerunHint: '@coderabbitai review',
    },
    { name: 'Bugbot', type: 'check', namePattern: 'bugbot', minTier: 1 },
  ],
};

const review = (user, state, commit = HEAD) => ({ user: { login: user }, state, commit_id: commit });
const run = (name, conclusion, status = 'completed') => ({ name, status, conclusion });

const passingBots = {
  reviews: [review('coderabbitai[bot]', 'APPROVED')],
  checkRuns: [run('Cursor Bugbot', 'success')],
};

const evaluate = (overrides = {}) =>
  evaluateGate({
    classification: { tier: 1, reasons: [], sizeExceeded: false },
    pr: { headSha: HEAD, draft: false, body: '', author: 'agent[bot]' },
    reviews: [],
    checkRuns: [],
    statuses: [],
    config,
    ...overrides,
  });

test('Tier 0 はボットのレビューを待たずに通過する', () => {
  const r = evaluate({ classification: { tier: 0, reasons: [], sizeExceeded: false } });
  assert.equal(r.state, 'success');
});

test('Tier 1 は両方のボットが HEAD で問題なしなら通過する', () => {
  const r = evaluate(passingBots);
  assert.equal(r.state, 'success');
  assert.equal(r.autoMergeEligible, true);
});

test('ボットの結果がまだなければ pending', () => {
  const r = evaluate({ reviews: [], checkRuns: [] });
  assert.equal(r.state, 'pending');
});

test('古いコミットへの APPROVED は流用せず、再レビューの方法を示して pending', () => {
  const r = evaluate({ ...passingBots, reviews: [review('coderabbitai[bot]', 'APPROVED', OLD)] });
  assert.equal(r.state, 'pending');
  assert.ok(r.details.some((d) => d.message.includes('@coderabbitai review')));
});

test('HEAD への CHANGES_REQUESTED は failure', () => {
  const r = evaluate({ ...passingBots, reviews: [review('coderabbitai[bot]', 'CHANGES_REQUESTED')] });
  assert.equal(r.state, 'failure');
});

test('古いコミットへの CHANGES_REQUESTED は修正後の再レビュー待ちとして pending', () => {
  const r = evaluate({
    ...passingBots,
    reviews: [review('coderabbitai[bot]', 'CHANGES_REQUESTED', OLD)],
  });
  assert.equal(r.state, 'pending');
});

test('最新のレビューだけを見る', () => {
  const r = evaluate({
    ...passingBots,
    reviews: [review('coderabbitai[bot]', 'CHANGES_REQUESTED'), review('coderabbitai[bot]', 'APPROVED')],
  });
  assert.equal(r.state, 'success');
});

test('acceptStates にない COMMENTED は未解決の指摘ありとして pending', () => {
  const r = evaluate({ ...passingBots, reviews: [review('coderabbitai[bot]', 'COMMENTED')] });
  assert.equal(r.state, 'pending');
});

test('check 型のボットは実行中なら pending、失敗なら failure', () => {
  assert.equal(evaluate({ ...passingBots, checkRuns: [run('Cursor Bugbot', null, 'in_progress')] }).state, 'pending');
  assert.equal(evaluate({ ...passingBots, checkRuns: [run('Cursor Bugbot', 'failure')] }).state, 'failure');
  assert.equal(evaluate({ ...passingBots, checkRuns: [run('Cursor Bugbot', 'neutral')] }).state, 'success');
});

test('status 型のボットはコミットステータスで判定する', () => {
  const cfg = {
    ...config,
    botReviewers: [{ name: 'X', type: 'status', contextPattern: '^x-review$', minTier: 1 }],
  };
  const base = { config: cfg, reviews: [], checkRuns: [] };
  assert.equal(evaluate({ ...base, statuses: [] }).state, 'pending');
  assert.equal(evaluate({ ...base, statuses: [{ context: 'x-review', state: 'pending' }] }).state, 'pending');
  assert.equal(evaluate({ ...base, statuses: [{ context: 'x-review', state: 'failure' }] }).state, 'failure');
  assert.equal(evaluate({ ...base, statuses: [{ context: 'x-review', state: 'success' }] }).state, 'success');
});

test('Tier 2 は Feature-Flag の記載がなければ failure', () => {
  const classification = { tier: 2, reasons: [], sizeExceeded: false };
  const noFlag = evaluate({ ...passingBots, classification });
  assert.equal(noFlag.state, 'failure');
  const placeholder = evaluate({
    ...passingBots,
    classification,
    pr: { headSha: HEAD, draft: false, body: 'Feature-Flag: <name>', author: 'agent[bot]' },
  });
  assert.equal(placeholder.state, 'failure');
  const ok = evaluate({
    ...passingBots,
    classification,
    pr: { headSha: HEAD, draft: false, body: 'summary\n\nFeature-Flag: new_checkout\n', author: 'agent[bot]' },
  });
  assert.equal(ok.state, 'success');
});

test('Tier 3 は人間の HEAD への承認がなければ pending', () => {
  const classification = { tier: 3, reasons: ['x'], sizeExceeded: false };
  assert.equal(evaluate({ ...passingBots, classification }).state, 'pending');
  const approved = evaluate({
    ...passingBots,
    classification,
    reviews: [...passingBots.reviews, review('owner', 'APPROVED')],
  });
  assert.equal(approved.state, 'success');
  assert.equal(approved.autoMergeEligible, false);
});

test('人間の承認が古いコミット向けなら無効', () => {
  const r = evaluate({
    ...passingBots,
    classification: { tier: 3, reasons: [], sizeExceeded: false },
    reviews: [...passingBots.reviews, review('owner', 'APPROVED', OLD)],
  });
  assert.equal(r.state, 'pending');
});

test('人間の CHANGES_REQUESTED は failure、COMMENTED は承認を取り消さない', () => {
  const classification = { tier: 3, reasons: [], sizeExceeded: false };
  const rejected = evaluate({
    ...passingBots,
    classification,
    reviews: [...passingBots.reviews, review('owner', 'APPROVED'), review('owner', 'CHANGES_REQUESTED')],
  });
  assert.equal(rejected.state, 'failure');
  const commented = evaluate({
    ...passingBots,
    classification,
    reviews: [...passingBots.reviews, review('owner', 'APPROVED'), review('owner', 'COMMENTED')],
  });
  assert.equal(commented.state, 'success');
});

test('humanApprovers 以外の承認は数えない', () => {
  const r = evaluate({
    ...passingBots,
    classification: { tier: 3, reasons: [], sizeExceeded: false },
    reviews: [...passingBots.reviews, review('someone', 'APPROVED')],
  });
  assert.equal(r.state, 'pending');
});

test('autoMergeMaxTier を超える Tier は人間の承認が必要（shadow mode）で、自動判定の結果も示す', () => {
  const r = evaluate({ ...passingBots, config: { ...config, autoMergeMaxTier: -1 } });
  assert.equal(r.state, 'pending');
  assert.equal(r.autoMergeEligible, false);
  assert.ok(r.details.some((d) => d.name === 'shadow' && d.message.includes('通過')));
});

test('変更行数の上限超過は failure', () => {
  const r = evaluate({ ...passingBots, classification: { tier: 1, reasons: [], sizeExceeded: true } });
  assert.equal(r.state, 'failure');
});

test('draft の PR は pending', () => {
  const r = evaluate({ ...passingBots, pr: { headSha: HEAD, draft: true, body: '', author: 'agent[bot]' } });
  assert.equal(r.state, 'pending');
});

test('description は commit status の上限 140 文字に収める', () => {
  const r = evaluate({ reviews: [], checkRuns: [] });
  assert.ok(r.description.length <= 140);
});
