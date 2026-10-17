'use strict';

const { matchesAny } = require('./glob');
const { compileTrusted } = require('./regexp');

// PR の変更内容から Tier を決める。
// 判定は「高い方を取る」だけで、ラベルや作者によって引き下げることはない。
function classifyTier({ files, labels = [], author, filesTruncated = false }, config) {
  const reasons = [];
  let tier = 0;
  const raise = (t, reason) => {
    if (t > tier) tier = t;
    reasons.push(`Tier ${t}: ${reason}`);
  };

  if (filesTruncated) {
    raise(3, '変更ファイル数が API の上限を超え、全体を検査できない');
  }

  const rules = config.rules.filter((r) => r.enabled !== false);
  const testPaths = config.tests?.paths ?? [];
  const skipRes = (config.tests?.skipPatterns ?? []).map((p) => compileTrusted(p));
  let changedLines = 0;

  for (const f of files) {
    const paths = [f.filename, f.previous_filename].filter(Boolean);
    const matched = rules.filter(
      (r) => !(r.exceptAuthors ?? []).includes(author) && paths.some((p) => matchesAny(p, r.paths)),
    );
    if (matched.length === 0) {
      if (config.defaultTier > tier) tier = config.defaultTier;
    } else {
      const top = matched.reduce((a, b) => (b.tier > a.tier ? b : a));
      if (top.tier >= 2) raise(top.tier, `${f.filename}（${top.id}）`);
      else if (top.tier > tier) tier = top.tier;
    }

    if (paths.some((p) => matchesAny(p, testPaths))) {
      if (f.status === 'removed') {
        raise(3, `テストファイルの削除: ${f.filename}`);
      } else if (typeof f.patch !== 'string') {
        raise(3, `差分を取得できないテストファイル: ${f.filename}`);
      } else {
        const added = f.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
        if (added.some((l) => skipRes.some((re) => re.test(l)))) {
          raise(3, `テストの skip を追加: ${f.filename}`);
        }
      }
    }

    if (!matchesAny(f.filename, config.sizeExclude ?? [])) {
      changedLines += (f.additions ?? 0) + (f.deletions ?? 0);
    }
  }

  for (const [label, t] of Object.entries(config.raiseLabels ?? {})) {
    if (labels.includes(label)) raise(t, `ラベル ${label}`);
  }

  let sizeExceeded = false;
  if (config.maxChangedLines && changedLines > config.maxChangedLines) {
    if (labels.includes(config.sizeExemptLabel)) {
      raise(3, `変更 ${changedLines} 行（上限超過を ${config.sizeExemptLabel} で許可）`);
    } else {
      sizeExceeded = true;
      reasons.push(`変更 ${changedLines} 行が上限 ${config.maxChangedLines} 行を超過`);
    }
  }

  return { tier, reasons, sizeExceeded, changedLines };
}

module.exports = { classifyTier };
