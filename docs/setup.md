# セットアップと運用

## 1. テンプレートリポジトリとして使う

このリポジトリ自体の設定:

- Settings → General → **Template repository** にチェックを入れる。

新しいプロジェクトを始めるとき:

1. **Use this template** で新しいリポジトリを作る。
2. `.github/CODEOWNERS` の `@ababa831` と、`.github/risk-tiers.json` の `humanApprovers` を自分のアカウントにする（同じ人なら変更不要）。
3. `Makefile` の `check` / `test` / `verify` / `audit` に、プロジェクト固有のコマンドを追加する。
4. `.github/workflows/ci.yml` の各ジョブに、言語のセットアップ（`actions/setup-python` など）を追加する。
5. `.github/dependabot.yml` に、使う言語のエコシステムを追加する。
6. `AGENTS.md` の「プロジェクト固有の規約」に、ディレクトリ構成、レイヤー境界、お手本となる機能を書く。
7. 以下の 2〜5 を設定する。

## 2. エージェント用のアカウントを分ける

GitHub では、自分が作った PR を自分で承認できない。エージェントがあなたのトークンで PR を出すと、Tier 3 の承認が成り立たない。エージェントには別の作成者を使わせる。

**A. マシンユーザー（ローカルのエージェント向け、手軽）**

1. エージェント用の GitHub アカウントを1つ作る（GitHub の規約では、1人につき1つのマシンアカウントが無料で認められている）。
2. 対象リポジトリに、そのアカウントを **Write** 権限の collaborator として招待する。
3. そのアカウントで fine-grained personal access token を作る。
   - Repository access: 対象リポジトリのみ
   - Permissions: Contents: Read and write / Pull requests: Read and write / Issues: Read and write / Metadata: Read
   - **Workflows は付けない**（`.github/workflows/` への push ができなくなる）
4. エージェントの環境で `GH_TOKEN` にそのトークンを設定する。git の push にもそのトークンを使う。

**B. GitHub App（クラウドのエージェントや複数リポジトリ向け）**

Settings → Developer settings → GitHub Apps で App を作る。権限は A と同じで、Workflows は付けない。対象リポジトリにインストールし、installation token をエージェントに渡す。

App の PR は作成者が bot になるため、CodeRabbit はレビューをスキップする。ゲートはその場合に人間の承認で代替するので、Tier 1 の PR も自動マージされなくなる。人間の承認を減らしたい場合は A を使う。

## 3. リポジトリの設定

Settings → General:

- Pull Requests: **Allow squash merging** だけを有効にする
- **Allow auto-merge** を有効にする
- **Automatically delete head branches** を有効にする

Settings → Actions → General:

- Workflow permissions: **Read repository contents and packages permissions**（各ワークフローが必要な権限を個別に宣言している）
- **Allow GitHub Actions to create and approve pull requests** は無効のままにする

Organization のリポジトリで使う場合は、gitleaks のライセンスキー（[gitleaks.io](https://gitleaks.io) で取得、1リポジトリまで無料）を Secret に登録する。個人アカウントのリポジトリでは不要:

```bash
gh secret set GITLEAKS_LICENSE --repo <owner>/<repo>
```

ラベルを作る（`tier:N` はゲートが自動で作る）:

```bash
gh label create risk:tier2 --color FBCA04 --description "大きな UX の変更。feature flag の後ろに実装する"
gh label create risk:tier3 --color B60205 --description "人間の承認が必要"
gh label create size:exempt --color C5DEF5 --description "変更行数の上限を超えることを許可（Tier 3 になる）"
gh label create main-broken --color B60205 --description "main の CI が失敗している"
```

## 4. ruleset（main の保護）

Settings → Rules → Rulesets → **New branch ruleset**:

- Enforcement status: **Active**
- Bypass list: **Repository admin**（あなた。緊急時の逃げ道）
- Target branches: **Include default branch**
- Rules:
  - **Restrict deletions**
  - **Block force pushes**
  - **Require a pull request before merging**
    - Required approvals: **0**（承認の要否はゲートが Tier で判断する）
    - **Require review from Code Owners** を有効にする（`.github/` などは GitHub 本体が承認を強制する）
    - **Dismiss stale pull request approvals when new commits are pushed** を有効にする
    - Allowed merge methods: **Squash**
  - **Require status checks to pass**: `agent-gate`, `check`, `test`, `verify`, `audit`, `secrets`, `sast`, `workflow-lint`
    - `agent-gate` はコミットステータス、それ以外は ci.yml のジョブ名。一度 PR で実行されると候補に表示される。

「Require conversation resolution before merging」は使わない。エージェントが修正せずにスレッドだけ resolve できてしまうため、指摘の解決はボットの再レビュー結果でゲートが判定する。

## 5. レビューボット

- **CodeRabbit**: リポジトリにインストールする。`.coderabbit.yaml` で変更要求と承認を出す設定（`request_changes_workflow: true`）にしてある。
- **Bugbot**: Cursor のダッシュボードで対象リポジトリを有効にする。レビュー方針は `.cursor/BUGBOT.md`。

使わないボットは `.github/risk-tiers.json` の `botReviewers` から外す。外さないと、そのボットの結果待ちで pending のままになる。

bot が作成した PR の扱い（`.github/risk-tiers.json`）:

- `reviewExemptAuthors`（初期値は Dependabot と Renovate）の PR では、AI レビューを必須にしない。どちらのボットも依存更新の PR をレビューしないため。版の更新は CI・`audit`・Dependabot の cooldown で検査する。Tier はパスで決まるので、ワークフローの更新（`.github/` の変更）は Tier 3 で、人間の承認が必要なまま。
- CodeRabbit がレビューをスキップしたとき（コミットステータスの説明が `Review skipped` になる）は、`skipStatus` で検出し、人間の承認で代替する。

shadow mode の間に次を確認する。サービス側の仕様は変わることがあるため、ゲートの前提が合っているかを実際の PR で見る。

- CodeRabbit のレビューの作成者が `coderabbitai[bot]` か
- CodeRabbit がエージェントの PR をレビューするか（マシンユーザーならレビューされ、App ならスキップされる）
- Bugbot のチェック名に `bugbot` が含まれるか（`namePattern`）

## 6. 最初のマージ（ブートストラップ）

ゲートのコードはデフォルトブランチから読み込むため、ゲートを追加する最初の PR では `agent-gate` が動かない。最初の PR だけは admin の bypass でマージし、その後に ruleset を有効にする。

## 7. 段階導入

`.github/risk-tiers.json` の `autoMergeMaxTier` で、人間の承認なしに通す Tier の上限を決める。

| 値 | 意味 |
|---|---|
| `-1`（初期値） | shadow mode。すべての PR に人間の承認が必要。ゲートのサマリーに「自動判定のみなら: 通過」などと表示される |
| `0` | Tier 0 を自動マージ |
| `1` | Tier 0〜1 を自動マージ |
| `2` | Tier 0〜2 を自動マージ（Tier 2 は flag OFF で出る） |

進め方:

1. `-1` で 2〜3 週間運用する。承認するときに、ゲートの自動判定と自分の判断が一致していたかを見る。
2. 一致するようになったら `0`、次に `1` に上げる。`1` に上げた後は週次の監査で問題がほぼ出ないことを確認してから `2` に上げる。
3. 値の変更は Tier 3 の PR になる（あなたの承認が必要）。

## 8. 運用

**日次（約5分）**
open な PR のうち、`agent-gate` があなたの承認待ちのものだけを見る。

```bash
gh pr list --label tier:3
```

**週次（約30〜60分）**

- 自動マージされた Tier 1 の PR から数件を抜き取って読む。
- Tier 2 の flag を ON にするか判断する。
- 見つけた問題は、その場の指摘で終わらせず、次のどれかに変える。
  1. `.semgrep/rules.yml` のルール
  2. テストやアーキテクチャテスト
  3. `risk-tiers.json` のルール（Tier を上げるパス）
  4. `AGENTS.md` や `.cursor/BUGBOT.md` の方針

macOS と Linux のどちらでも動く（GNU date の書き方を試し、失敗したら BSD date の書き方を使う）:

```bash
gh pr list --state merged --label tier:1 --search "merged:>=$(date -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)" --limit 50
```

**外部公開するとき**
`risk-tiers.json` の `public-release` ルールの `enabled` を `true` にし、パスをプロジェクトに合わせて調整する。

## 9. GitHub Actions の実行時間

個人の Pro プランでは、private リポジトリの Actions 無料枠は月 3,000 分（public リポジトリは無料）。

- CI は push ごとに 7 ジョブが走る。1 ジョブは最低 1 分として課金される。
- ゲートは PR の更新・レビュー・外部ボットのチェック完了ごとに 1 回走る。GitHub Actions 自身のチェック完了では走らない。
- 枠が足りなくなったら、`verify` を変更パスで絞る、`sast` と `secrets` を1ジョブにまとめる、などで減らす。

## 10. 制約

- Tier はパスで判定する。認証処理が想定外のパスに置かれると Tier 1 として扱われる。コードの配置規約と AI レビューで補う。
- テストの期待値を実装に合わせて書き換える変更は、機械的には検出しない。CodeRabbit と Bugbot の方針で重点的に見させている。
- ゲートの再評価はイベントで起動する。pending のまま進まないときは Actions の **gate** ワークフローを `workflow_dispatch` で実行する。
