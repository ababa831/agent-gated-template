'use strict';

// actions/github-script から呼ぶ接続層。判定ロジックは lib/ にあり、ここは API の入出力だけを扱う。
// ワークフローはこのファイルと risk-tiers.json をデフォルトブランチから読み込むため、
// PR 内でゲートを書き換えてもその PR の判定には効かない。

const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { classifyTier } = require('./lib/classify');
const { evaluateGate } = require('./lib/evaluate');

const STATUS_CONTEXT = 'agent-gate';
const TIER_LABEL_PREFIX = 'tier:';
const MAX_FILES = 3000;
const STATE_ICON = { success: '✅', pending: '⏳', failure: '❌' };

async function targetPrNumbers({ github, context }) {
  const { eventName, payload, repo } = context;
  switch (eventName) {
    case 'pull_request':
    case 'pull_request_review':
      return [payload.pull_request.number];
    case 'check_run':
      return payload.check_run.pull_requests.map((p) => p.number);
    case 'status': {
      if (payload.context === STATUS_CONTEXT) return [];
      const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
        ...repo,
        commit_sha: payload.sha,
      });
      return data.filter((p) => p.state === 'open').map((p) => p.number);
    }
    case 'workflow_dispatch': {
      if (payload.inputs?.pr) return [Number(payload.inputs.pr)];
      const prs = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 });
      return prs.map((p) => p.number);
    }
    default:
      return [];
  }
}

async function syncTierLabel({ github, context }, pr, tier) {
  const want = `${TIER_LABEL_PREFIX}${tier}`;
  const current = pr.labels.map((l) => l.name).filter((n) => n.startsWith(TIER_LABEL_PREFIX));
  for (const name of current.filter((n) => n !== want)) {
    await github.rest.issues.removeLabel({ ...context.repo, issue_number: pr.number, name });
  }
  if (!current.includes(want)) {
    await github.rest.issues.addLabels({ ...context.repo, issue_number: pr.number, labels: [want] });
  }
}

async function evaluatePr({ github, context, core }, config, number) {
  const { repo } = context;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (pr.state !== 'open') return null;
  const headSha = pr.head.sha;

  const [files, reviews, checkRuns, combined] = await Promise.all([
    github.paginate(github.rest.pulls.listFiles, { ...repo, pull_number: number, per_page: 100 }),
    github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: number, per_page: 100 }),
    github.paginate(github.rest.checks.listForRef, { ...repo, ref: headSha, per_page: 100 }),
    github.rest.repos.getCombinedStatusForRef({ ...repo, ref: headSha, per_page: 100 }),
  ]);

  const classification = classifyTier(
    {
      files,
      labels: pr.labels.map((l) => l.name),
      author: pr.user.login,
      filesTruncated: files.length >= MAX_FILES,
    },
    config,
  );
  const result = evaluateGate({
    classification,
    pr: { headSha, draft: pr.draft, body: pr.body, author: pr.user.login },
    reviews,
    checkRuns,
    statuses: combined.data.statuses.filter((s) => s.context !== STATUS_CONTEXT),
    config,
  });

  await github.rest.repos.createCommitStatus({
    ...repo,
    sha: headSha,
    state: result.state,
    context: STATUS_CONTEXT,
    description: result.description,
    target_url: `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`,
  });
  await syncTierLabel({ github, context }, pr, classification.tier);

  core.summary
    .addHeading(`#${number} ${STATE_ICON[result.state]} Tier ${classification.tier}`, 3)
    .addTable([
      [
        { data: '項目', header: true },
        { data: '状態', header: true },
        { data: '内容', header: true },
      ],
      ...result.details.map((d) => [d.name, `${STATE_ICON[d.state]} ${d.state}`, d.message]),
    ])
    .addList(classification.reasons.length ? classification.reasons : ['Tier を引き上げる要因なし'])
    .addRaw(`自動マージ対象: ${result.autoMergeEligible ? 'はい' : 'いいえ（人間の承認が必要）'}\n`);
  core.info(`#${number}: ${result.state} - ${result.description}`);
  return result;
}

module.exports = async function main({ github, context, core }) {
  const config = loadConfig(path.join(process.env.GITHUB_WORKSPACE, '.github/risk-tiers.json'));
  const numbers = await targetPrNumbers({ github, context });
  if (numbers.length === 0) {
    core.info(`${context.eventName}: 対象の PR なし`);
    return;
  }
  for (const number of numbers) {
    await evaluatePr({ github, context, core }, config, number);
  }
  await core.summary.write();
};
