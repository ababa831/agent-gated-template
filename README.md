# agent-gated-template

[English](README.en.md)

コーディングエージェントが PR を作り、人間が毎回レビューしなくても開発が止まらない体制を作るための GitHub テンプレートリポジトリ。

PR を変更内容のリスクで Tier 0〜3 に分け、Tier に応じた条件（CI、AI レビュー、feature flag、人間の承認）を満たしたものだけをマージする。人間が承認するのは、ゲートや CI の変更、依存の追加、テストの削除など、エージェントが自分の制約を緩められる変更に絞る。

## 仕組み

```
エージェントが PR を作成し auto-merge を有効にする
        ↓
ci.yml      check / test / verify / audit / secrets / sast / workflow-lint
gate.yml    変更パスから Tier を判定し、ボットと人間の状態をまとめて
            コミットステータス agent-gate を付ける
        ↓
すべて通ればマージ（Tier 3 などは人間の承認後にマージ）
```

| Tier | 主な対象 | 通過条件 |
|---|---|---|
| 0 | ドキュメント、テストの追加・修正 | CI |
| 1 | 通常の変更 | CI ＋ CodeRabbit の承認 ＋ Bugbot の成功（最新コミットに対して） |
| 2 | 大きな UX の変更（`risk:tier2` ラベル） | Tier 1 ＋ 初期値 OFF の feature flag |
| 3 | ゲート・CI・エージェントへの指示、lint 設定、依存の追加、テストの削除や skip | Tier 1 ＋ 人間の承認 |

- 判定の設定は [`.github/risk-tiers.json`](.github/risk-tiers.json) に一元化している。
- ゲートのコードと設定はデフォルトブランチから読み込む。PR でゲートを書き換えても、その PR の判定には効かない。
- `.github/` などは CODEOWNERS で守り、GitHub 本体の仕組みでも人間の承認を必須にしている。
- ボットや人間のレビューは、PR の最新コミットに対するものだけを有効とする。
- `autoMergeMaxTier` で、人間の承認なしに通す Tier を段階的に広げる（初期値はすべて承認が必要な shadow mode）。

## 構成

| パス | 内容 |
|---|---|
| `Makefile` | CI とエージェントが使う共通コマンド（`check` / `test` / `verify` / `audit`）。言語ごとの処理はここに書く |
| `.github/workflows/ci.yml` | CI。Makefile を呼ぶだけ。main で落ちたら `main-broken` の Issue を作る |
| `.github/workflows/gate.yml` | ゲート |
| `.github/workflows/dependabot-auto-merge.yml` | Dependabot の PR で auto-merge を有効にする（major を除く） |
| `.github/gate/` | ゲートの判定ロジック（外部依存なしの Node.js）とテスト |
| `.github/risk-tiers.json` | Tier の判定ルール、ボットの設定、承認者 |
| `.github/CODEOWNERS` | 人間の承認を必須にするパス |
| `AGENTS.md` / `CLAUDE.md` | エージェントへの作業ルール |
| `.coderabbit.yaml` / `.cursor/BUGBOT.md` | AI レビューの方針 |
| `.semgrep/rules.yml` | プロジェクト固有の静的解析ルール |
| `docs/setup.md` | セットアップと運用の手順 |

## はじめかた

前提条件:

- GitHub の private リポジトリで ruleset と auto-merge を使うには、個人の Pro 以上のプランが必要（public リポジトリなら Free でよい）
- エージェント用の別アカウント（マシンユーザーか GitHub App）
- CodeRabbit と Cursor Bugbot（使わない場合は `.github/risk-tiers.json` の `botReviewers` から外す）

手順は [docs/setup.md](docs/setup.md) を参照。要点:

1. エージェントには別のアカウント（マシンユーザーか GitHub App）で PR を出させる。
2. ruleset で `agent-gate` と CI のジョブを required status check にし、Code Owners のレビューを必須にする。
3. shadow mode で 2〜3 週間運用してから、`autoMergeMaxTier` を上げる。

## ゲートの検査を手元で実行する

前提条件: Node.js 22 以降と make。リポジトリのルートで実行する。

```bash
make check
```

何も出力されずに終了すれば成功。

```bash
make test
```

最後に `ℹ fail 0` と表示されれば成功。
