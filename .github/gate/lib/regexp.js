'use strict';

// 動的な正規表現は、すべてここで組み立てる。
// 入力はリポジトリの設定（.github/risk-tiers.json）か、エスケープ済みの文字列だけに限る。
// 設定はデフォルトブランチから読み込み、CODEOWNERS で人間の承認を必須にしているため、
// PR の作成者やボットが中身を決めることはできない。

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTrusted(pattern, flags) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(pattern, flags);
}

module.exports = { escapeRegExp, compileTrusted };
