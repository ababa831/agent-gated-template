# CI とエージェントが使う共通のコマンド。CI（.github/workflows/ci.yml）はこの4つを呼ぶだけ。
# プロジェクトを始めたら、各ターゲットの「プロジェクト固有」の行をスタックに合わせて追加する。
# ゲート自体の検査（gate-*）は消さない。

.PHONY: check test verify audit gate-check gate-test

## format / lint / 型チェック / アーキテクチャテスト
check: gate-check
	@# プロジェクト固有: 例) npx eslint . && npx tsc --noEmit && npx depcruise src

## unit + integration
test: gate-test
	@# プロジェクト固有: 例) npx vitest run / uv run pytest / go test ./...

## アプリを起動して実際に操作し、証拠を artifacts/verify/ に出力する
verify:
	@# プロジェクト固有: 例) npx playwright test
	@echo "verify: このテンプレートには起動するアプリがない。プロジェクトで置き換える。"

## 依存関係の脆弱性・ライセンス検査
audit:
	@# プロジェクト固有: 例) npm audit --audit-level=high / uv run pip-audit / govulncheck ./...
	@echo "audit: このテンプレートには依存関係がない。プロジェクトで置き換える。"

gate-check:
	@for f in .github/gate/*.js .github/gate/lib/*.js .github/gate/test/*.js; do node --check "$$f" || exit 1; done
	@node -e "require('./.github/gate/lib/config').loadConfig('.github/risk-tiers.json')"
	@if command -v actionlint >/dev/null 2>&1; then actionlint; fi

gate-test:
	@node --test ".github/gate/test/*.test.js"
