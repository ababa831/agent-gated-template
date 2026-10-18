# agent-gated-template

[日本語](README.md)

A GitHub template repository for a workflow in which coding agents open pull requests and development keeps moving without a human reviewing every one.

Each PR is classified into Tier 0–3 by the risk of what it changes, and is merged only when the conditions for its tier are met (CI, AI review, a feature flag, human approval). Human approval is reserved for changes through which an agent could loosen its own constraints: the gate and CI, dependency additions, test deletions, and so on.

## How it works

```
The agent opens a PR and enables auto-merge
        ↓
ci.yml      check / test / verify / audit / secrets / sast / workflow-lint
gate.yml    classifies the tier from the changed paths, combines the bot and
            human review state, and sets the commit status agent-gate
        ↓
Merged once everything passes (Tier 3 and similar wait for human approval)
```

| Tier | Typical changes | Conditions |
|---|---|---|
| 0 | Docs, adding or editing tests | CI |
| 1 | Regular changes | CI + CodeRabbit approval + Bugbot success (on the latest commit) |
| 2 | Large UX changes (`risk:tier2` label) | Tier 1 + a feature flag that defaults to OFF |
| 3 | Gate, CI and agent instructions, lint config, new dependencies, deleted or skipped tests | Tier 1 + human approval |

- All classification settings live in [`.github/risk-tiers.json`](.github/risk-tiers.json).
- The gate code and its config are loaded from the default branch, so a PR that edits the gate cannot change how that PR is judged.
- `.github/` and related paths are also protected by CODEOWNERS, so GitHub itself requires human approval for them.
- Bot and human reviews count only when they are on the PR's latest commit.
- `autoMergeMaxTier` widens, step by step, which tiers pass without human approval (it starts in shadow mode, where every PR needs approval).

## Layout

| Path | Contents |
|---|---|
| `Makefile` | Shared commands for CI and agents (`check` / `test` / `verify` / `audit`); put language-specific steps here |
| `.github/workflows/ci.yml` | CI, which only calls the Makefile; opens a `main-broken` issue when main fails |
| `.github/workflows/gate.yml` | The gate |
| `.github/workflows/dependabot-auto-merge.yml` | Enables auto-merge on Dependabot PRs (except major updates) |
| `.github/gate/` | Gate logic (dependency-free Node.js) and its tests |
| `.github/risk-tiers.json` | Tier rules, bot settings, approvers |
| `.github/CODEOWNERS` | Paths that require human approval |
| `AGENTS.md` / `CLAUDE.md` | Working rules for agents |
| `.coderabbit.yaml` / `.cursor/BUGBOT.md` | AI review guidance |
| `.semgrep/rules.yml` | Project-specific static analysis rules |
| `docs/setup.md` | Setup and operations guide (Japanese) |

## Getting started

Prerequisites:

- A personal GitHub Pro plan or higher to use rulesets and auto-merge on private repositories (Free is enough for public ones)
- A separate account for the agent (a machine user or a GitHub App)
- CodeRabbit and Cursor Bugbot (if you do not use one, remove it from `botReviewers` in `.github/risk-tiers.json`)

See [docs/setup.md](docs/setup.md) for the steps. In short:

1. Have agents open PRs from a separate account (a machine user or a GitHub App).
2. In a ruleset, make `agent-gate` and the CI jobs required status checks and require Code Owners review.
3. Run in shadow mode for two to three weeks before raising `autoMergeMaxTier`.

## Running the gate checks locally

Prerequisites: Node.js 22 or later and make. Run from the repository root.

```bash
make check
```

It succeeds when it exits without printing anything.

```bash
make test
```

It succeeds when the last lines include `ℹ fail 0`.
