'use strict';

// Tier とレビュー・チェックの状態から、ゲートの結果（success / pending / failure）を決める。
// どの外部サービスの結果も、PR の HEAD コミットに対するものだけを有効とする。

const { escapeRegExp, compileTrusted } = require('./regexp');

const OK_CONCLUSIONS = ['success', 'neutral', 'skipped'];
const DECISIVE_STATES = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'];
const MAX_DESCRIPTION = 140;

const loginOf = (r) => r.user?.login;

// ボットがこの PR をレビュー対象外としてスキップしたか（例: CodeRabbit は bot が作成した PR をレビューしない）。
// スキップされた結果は来ないため、待ち続けずに人間の承認で代替する。
function skippedBy(bot, statuses) {
  if (!bot.skipStatus) return false;
  const contextRe = compileTrusted(bot.skipStatus.contextPattern);
  const descriptionRe = compileTrusted(bot.skipStatus.descriptionPattern, 'i');
  return statuses.some((s) => contextRe.test(s.context) && descriptionRe.test(s.description ?? ''));
}

function evaluateBot(bot, { headSha, reviews, checkRuns, statuses }) {
  const name = bot.name;
  if (skippedBy(bot, statuses)) {
    return { name, state: 'success', skipped: true, message: 'この PR のレビューをスキップした。人間の承認で代替する' };
  }
  if (bot.type === 'review') {
    const mine = reviews.filter((r) => loginOf(r) === bot.login);
    const latest = mine[mine.length - 1];
    const hint = bot.rerunHint ? `（再レビューは PR に「${bot.rerunHint}」とコメント）` : '';
    if (!latest) return { name, state: 'pending', message: 'レビュー待ち' };
    if (latest.commit_id !== headSha) {
      return { name, state: 'pending', message: `最新コミットのレビュー待ち${hint}` };
    }
    if (latest.state === 'CHANGES_REQUESTED') {
      return { name, state: 'failure', message: '変更要求あり。指摘を修正して push する' };
    }
    if ((bot.acceptStates ?? ['APPROVED']).includes(latest.state)) {
      return { name, state: 'success', message: latest.state };
    }
    return { name, state: 'pending', message: `未解決の指摘あり（${latest.state}）${hint}` };
  }

  if (bot.type === 'check') {
    const re = compileTrusted(bot.namePattern, 'i');
    const run = checkRuns.filter((c) => re.test(c.name)).pop();
    if (!run) return { name, state: 'pending', message: 'チェック待ち' };
    if (run.status !== 'completed') return { name, state: 'pending', message: `実行中（${run.status}）` };
    if (OK_CONCLUSIONS.includes(run.conclusion)) return { name, state: 'success', message: run.conclusion };
    return { name, state: 'failure', message: `結果: ${run.conclusion}` };
  }

  if (bot.type === 'status') {
    const re = compileTrusted(bot.contextPattern);
    const st = statuses.find((s) => re.test(s.context));
    if (!st) return { name, state: 'pending', message: 'ステータス待ち' };
    if (st.state === 'success') return { name, state: 'success', message: 'success' };
    if (st.state === 'pending') return { name, state: 'pending', message: '実行中' };
    return { name, state: 'failure', message: `結果: ${st.state}` };
  }

  return { name, state: 'failure', message: `未知の種別: ${bot.type}` };
}

function evaluateHuman(config, { headSha, reviews }) {
  const name = 'human';
  const approvers = config.humanApprovers;
  const decisive = reviews.filter((r) => approvers.includes(loginOf(r)) && DECISIVE_STATES.includes(r.state));
  const latestByUser = new Map();
  for (const r of decisive) latestByUser.set(loginOf(r), r);
  const latest = [...latestByUser.values()];
  if (latest.some((r) => r.state === 'CHANGES_REQUESTED')) {
    return { name, state: 'failure', message: '人間のレビューで変更要求あり' };
  }
  if (latest.some((r) => r.state === 'APPROVED' && r.commit_id === headSha)) {
    return { name, state: 'success', message: '人間が承認済み' };
  }
  return { name, state: 'pending', message: `${approvers.join(', ')} の承認待ち（最新コミットへの承認が必要）` };
}

function featureFlagOf(body, trailer) {
  const re = compileTrusted(`^${escapeRegExp(trailer)}:[ \\t]*(\\S+)[ \\t]*$`, 'mi');
  const m = (body ?? '').match(re);
  if (!m) return null;
  const value = m[1];
  if (/^<.*>$/.test(value) || /^(none|n\/a|-)$/i.test(value)) return null;
  return value;
}

function combine(details) {
  if (details.some((d) => d.state === 'failure')) return 'failure';
  if (details.some((d) => d.state === 'pending')) return 'pending';
  return 'success';
}

function evaluateGate({ classification, pr, reviews = [], checkRuns = [], statuses = [], config }) {
  const { tier } = classification;
  const ctx = { headSha: pr.headSha, reviews, checkRuns, statuses };
  const details = [];

  if (pr.draft) details.push({ name: 'draft', state: 'pending', message: 'Draft PR' });

  if (classification.sizeExceeded) {
    details.push({
      name: 'size',
      state: 'failure',
      message: `変更行数が上限 ${config.maxChangedLines ?? ''} 行を超過。PR を分割する`,
    });
  }

  let botSkipped = false;
  if ((config.reviewExemptAuthors ?? []).includes(pr.author)) {
    details.push({
      name: 'bot-review',
      state: 'success',
      message: `${pr.author} の PR は AI レビューの対象外（CI と audit で検査）`,
    });
  } else {
    for (const bot of config.botReviewers) {
      if (tier < (bot.minTier ?? 1)) continue;
      const result = evaluateBot(bot, ctx);
      if (result.skipped) botSkipped = true;
      details.push(result);
    }
  }

  if (tier === 2) {
    const trailer = config.featureFlag?.trailer ?? 'Feature-Flag';
    const flag = featureFlagOf(pr.body, trailer);
    details.push(
      flag
        ? { name: 'feature-flag', state: 'success', message: `${trailer}: ${flag}（初期値 OFF）` }
        : {
            name: 'feature-flag',
            state: 'failure',
            message: `Tier 2 は PR 本文に「${trailer}: <flag名>」が必要（初期値 OFF で出す）`,
          },
    );
  }

  const automated = combine(details);
  const needsHuman = tier >= 3 || tier > config.autoMergeMaxTier || botSkipped;
  if (needsHuman) {
    if (tier < 3 && tier > config.autoMergeMaxTier) {
      const verdict = { success: '通過', pending: '待機中', failure: '不合格' }[automated];
      details.push({
        name: 'shadow',
        state: 'success',
        message: `autoMergeMaxTier=${config.autoMergeMaxTier} のため人間の承認が必要。自動判定のみなら: ${verdict}`,
      });
    }
    details.push(evaluateHuman(config, ctx));
  }

  const state = combine(details);
  const blocking = details.filter((d) => d.state === state && state !== 'success');
  const summary =
    state === 'success'
      ? `Tier ${tier}: 通過`
      : `Tier ${tier}: ${blocking.map((d) => `${d.name}: ${d.message}`).join(' / ')}`;
  const description = summary.length > MAX_DESCRIPTION ? `${summary.slice(0, MAX_DESCRIPTION - 1)}…` : summary;

  return { state, description, details, autoMergeEligible: !needsHuman };
}

module.exports = { evaluateGate, featureFlagOf };
