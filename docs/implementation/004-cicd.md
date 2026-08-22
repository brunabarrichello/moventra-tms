# 004 — CI/CD

## Status

- Specification: defined
- Physical implementation: partial
- Validation: partial
- Gate: BLOCKED
- Macro gate: G1 — Foundation Ready: not approved
- Promotion to 005 — Secrets Management: NOT AUTHORIZED

## Objective

Establish an automated, reproducible and auditable delivery pipeline for Moventra TMS, preserving the official execution order and producing evidence tied to repository, commit, actor, artifact and deployment.

## Executable foundation

PR #4 (`phase/004-cicd-completion`) introduces a real executable foundation instead of documentation-only CI:

- `moventra-api` executable with Node.js 22.x;
- `/health` endpoint;
- unit tests;
- architecture dependency test;
- HTTP integration tests;
- repository-owned lint/test/build hooks;
- deterministic build script;
- immutable artifact name tied to `GITHUB_SHA`;
- SHA-256 checksum;
- build manifest with product, service, commit SHA and artifact name;
- GitHub Actions jobs split into repository contract, lint, tests, security baseline, build and evidence.

Stable CI contract:

```text
scripts/ci/lint.sh
scripts/ci/test.sh
scripts/ci/build.sh
```

## Required flow

```text
Pull Request
  -> Repository policy
  -> Lint / static analysis
  -> Unit tests
  -> Architecture tests
  -> Integration tests
  -> Security checks
  -> Build once
  -> Immutable artifact
  -> Deploy development/test
  -> Staging
  -> Approval
  -> Production
```

## Evidence matrix

| Requirement | Status | Evidence |
|---|---|---|
| Executable application | IMPLEMENTED | PR #4 contains `src/server.js`, HTTP handler and `/health` |
| Lint hook | IMPLEMENTED / EXECUTION PENDING | `scripts/ci/lint.sh` exists and is required by workflow |
| Unit tests | IMPLEMENTED / EXECUTION PENDING | `tests/unit/*.test.js` |
| Architecture tests | IMPLEMENTED / EXECUTION PENDING | `tests/architecture/*.test.js` |
| Integration tests | IMPLEMENTED / EXECUTION PENDING | `tests/integration/*.test.js` |
| Build hook | IMPLEMENTED / EXECUTION PENDING | `scripts/ci/build.sh` |
| Immutable artifact | IMPLEMENTED / ARTIFACT EVIDENCE PENDING | build outputs `moventra-tms-<commit>.tar.gz` and `.sha256` |
| Development/test deployment | EVIDENCED | Vercel project `moventra-tms`, deployment `dpl_HYdatwycPdDBuyrzwgpwUVgghC4i`, READY, `/health` HTTP 200 |
| Staging | EVIDENCED | Vercel project `moventra-tms-staging`, latest deployment `dpl_HJLskyLSEReNokhoMigzK7w1Zhvn`, READY, `/health` HTTP 200 |
| Rollback target identification | EVIDENCED | previous staging deployment `dpl_6HWgnpEZtQzSieR4uFfNLTTtX5Yx` is retained and reported by Vercel as `isRollbackCandidate=true` |
| Rollback execution | PENDING | no rollback may be declared validated until a controlled rollback exercise is executed and smoke-tested |
| Production approval | BLOCKED | protected production approval policy not evidenced |
| Branch protection | BLOCKED | GitHub `main` currently reports `protected=false` and required status checks disabled |
| PR CI execution evidence | BLOCKED/PENDING | no GitHub Actions workflow run is currently observable for PR #4 through the connected GitHub Actions evidence endpoint |

## Deployment evidence

### Development/test

```text
project: moventra-tms
deployment: dpl_HYdatwycPdDBuyrzwgpwUVgghC4i
state: READY
health: HTTP 200
```

### Staging

```text
project: moventra-tms-staging
current deployment: dpl_HJLskyLSEReNokhoMigzK7w1Zhvn
previous deployment: dpl_6HWgnpEZtQzSieR4uFfNLTTtX5Yx
previous deployment rollback candidate: true
current state: READY
health: HTTP 200
```

Deployment IDs are immutable revision identifiers and must be recorded in release evidence. Commit-to-artifact traceability remains a responsibility of the CI build manifest and must not be inferred only from a deployment URL.

## Remaining blockers

### B004-03 — Branch protection disabled

Observed repository state on `main`:

```text
protected=false
required_status_checks.enforcement_level=off
```

Required before gate approval:

- protect `main`;
- require PR before merge;
- require agreed CI checks;
- require review policy;
- prevent bypass except explicitly governed emergency path.

### B004-04 — GitHub Actions run not evidenced

The workflow definition is present in PR #4, but no pull-request workflow run is currently observable through the connected Actions evidence endpoint.

Required before gate approval:

- one successful PR execution;
- successful lint, tests, security and build jobs;
- uploaded immutable application artifact;
- uploaded CI evidence artifact;
- artifact/run traceability to commit and actor.

### B004-05 — Protected production approval not evidenced

The production promotion path must require explicit approval through a protected environment or equivalent governed control. A plain deploy command is not approval evidence.

### B004-06 — Rollback drill pending

A concrete prior staging deployment is already identified as a rollback candidate, but the rollback exercise itself has not been executed. Gate approval requires restoration to the previous deployment followed by smoke validation and evidence of the result.

## Gate decision

**004 — CI/CD remains IN PROGRESS / BLOCKED.**

The original blockers for executable application and deployment targets were materially reduced: the application exists and both deploy/test and staging targets are operational. However, the official gate cannot be approved while PR CI execution, branch protection, protected production approval and the rollback drill remain without complete evidence.

Therefore:

```text
004 != CONCLUDED
G1 != APPROVED
005 != ACTIVE
```

No dependent phase is promoted solely because code or deployment resources now exist.
