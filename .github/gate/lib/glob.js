'use strict';

// 外部依存なしの最小限の glob。パスはリポジトリルートからの相対パス（先頭の / なし）。
//   *    ディレクトリ区切りをまたがない任意の文字列
//   ?    ディレクトリ区切り以外の1文字
//   **/  0個以上のディレクトリ
//   /**  末尾に置くと配下すべて

const cache = new Map();

function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      const atSegmentStart = i === 0 || pattern[i - 1] === '/';
      if (atSegmentStart && pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const compiled = new RegExp(`^${re}$`);
  cache.set(pattern, compiled);
  return compiled;
}

function matchesGlob(path, pattern) {
  return globToRegExp(pattern).test(path);
}

function matchesAny(path, patterns) {
  return patterns.some((p) => matchesGlob(path, p));
}

module.exports = { matchesGlob, matchesAny };
