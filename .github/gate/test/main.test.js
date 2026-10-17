'use strict';

// GitHub API をモックして、接続層（main.js）のイベントの振り分けと出力を検査する。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const main = require('../main');

process.env.GITHUB_WORKSPACE = path.resolve(__dirname, '../../..');

function fakeGithub({ files, reviews = [], checkRuns = [], labels = [] }) {
  const calls = { statuses: [], addLabels: [], removeLabel: [] };
  const pr = {
    number: 7,
    state: 'open',
    draft: false,
    body: '',
    head: { sha: 'head-sha' },
    user: { login: 'agent[bot]' },
    labels: labels.map((name) => ({ name })),
  };
  const rest = {
    pulls: {
      get: async () => ({ data: pr }),
      listFiles: 'listFiles',
      listReviews: 'listReviews',
      list: 'list',
    },
    checks: { listForRef: 'listForRef' },
    repos: {
      getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
      createCommitStatus: async (args) => calls.statuses.push(args),
      listPullRequestsAssociatedWithCommit: async () => ({ data: [{ number: 7, state: 'open' }] }),
    },
    issues: {
      addLabels: async (args) => calls.addLabels.push(args),
      removeLabel: async (args) => calls.removeLabel.push(args),
    },
  };
  const pages = { listFiles: files, listReviews: reviews, listForRef: checkRuns, list: [pr] };
  return { calls, github: { rest, paginate: async (fn) => pages[fn] } };
}

function fakeCore() {
  const summary = {
    addHeading: () => summary,
    addTable: () => summary,
    addList: () => summary,
    addRaw: () => summary,
    write: async () => {},
  };
  return { summary, info: () => {} };
}

const context = (eventName, payload) => ({
  eventName,
  payload,
  repo: { owner: 'o', repo: 'r' },
  serverUrl: 'https://github.com',
  runId: 1,
});

const docsOnly = [{ filename: 'README.md', status: 'modified', additions: 1, deletions: 0, patch: '+x' }];

test('pull_request: HEAD に agent-gate ステータスを付け、tier ラベルを同期する', async () => {
  const { github, calls } = fakeGithub({ files: docsOnly, labels: ['tier:1', 'bug'] });
  await main({ github, context: context('pull_request', { pull_request: { number: 7 } }), core: fakeCore() });
  assert.equal(calls.statuses.length, 1);
  assert.equal(calls.statuses[0].sha, 'head-sha');
  assert.equal(calls.statuses[0].context, 'agent-gate');
  // テンプレートの初期値は shadow mode（autoMergeMaxTier = -1）なので、Tier 0 でも人間の承認待ち
  assert.equal(calls.statuses[0].state, 'pending');
  assert.deepEqual(calls.removeLabel.map((c) => c.name), ['tier:1']);
  assert.deepEqual(calls.addLabels.map((c) => c.labels), [['tier:0']]);
});

test('check_run: 紐づく PR を再評価する', async () => {
  const { github, calls } = fakeGithub({ files: docsOnly });
  const payload = { check_run: { app: { slug: 'cursor' }, pull_requests: [{ number: 7 }] } };
  await main({ github, context: context('check_run', payload), core: fakeCore() });
  assert.equal(calls.statuses.length, 1);
});

test('check_run: pull_requests が空なら head_sha から PR を探す', async () => {
  const { github, calls } = fakeGithub({ files: docsOnly });
  const payload = { check_run: { app: { slug: 'cursor' }, head_sha: 'head-sha', pull_requests: [] } };
  await main({ github, context: context('check_run', payload), core: fakeCore() });
  assert.equal(calls.statuses.length, 1);
});

test('status: ゲート自身のステータスでは再評価しない', async () => {
  const { github, calls } = fakeGithub({ files: docsOnly });
  await main({ github, context: context('status', { context: 'agent-gate', sha: 's' }), core: fakeCore() });
  assert.equal(calls.statuses.length, 0);
  await main({ github, context: context('status', { context: 'other', sha: 's' }), core: fakeCore() });
  assert.equal(calls.statuses.length, 1);
});

test('workflow_dispatch: PR 番号がなければ open な PR をすべて評価する', async () => {
  const { github, calls } = fakeGithub({ files: docsOnly });
  await main({ github, context: context('workflow_dispatch', { inputs: {} }), core: fakeCore() });
  assert.equal(calls.statuses.length, 1);
});
