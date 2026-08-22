# 004 — CI/CD

## Status

- Specification: defined
- Physical implementation: substantially implemented
- Validation: partial — CI/build/artifact/deploy/staging evidenced
- Gate: BLOCKED
- Macro gate: G1 — Foundation Ready: not approved
- Promotion to 005 — Secrets Management: NOT AUTHORIZED

## Objective

Establish an automated, reproducible and auditable delivery pipeline for Moventra TMS, preserving the official execution order and producing evidence tied to repository, commit, actor, artifact and deployment.

## Executable foundation

PR #4 (`phase/004-cicd-completion`) contains a real executable foundation instead of documentation-only CI:

- `moventra-api` executable with Node.js 22.x;
- `/health` endpoint;
- unit tests;
- architecture dependency test;
- HTTP integration tests;
- repository-owned lint/test/build hooks;
- deterministic build script;
- immutable artifact name tied to the GitHub Actions execution SHA;
- portable SHA-256 checksum that can be validated after artifact extraction;
- build manifest with product, service, commit SHA and artifact name;
- GitHub Actions jobs split into repository contract, lint, tests, security baseline, build and evidence;
- release gate workflow with explicit `staging` and `production` GitHub environments.

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

## CI execution evidence

A real pull-request execution is now evidenced.

```text
workflow: Moventra CI
run_id: 32569208155
run_number: 9
head_branch: phase/004-cicd-completion
head_sha: 35654f85a0529a636ddf0f0e2a2e876c2f13f45c
pull_request_merge_sha: 459241c6a239ff9ae92b5f8817fd99407e44c49d
result: success
```

For `pull_request` workflows, GitHub executes against the synthetic merge commit. Therefore `GITHUB_SHA` for this run is `459241c6a239ff9ae92b5f8817fd99407e44c49d`, while the workflow metadata preserves the source branch head SHA `35654f85a0529a636ddf0f0e2a2e876c2f13f45c`. Both identifiers must remain in the audit trail.

Successful jobs in run `32569208155`:

- Repository contract;
- Security baseline;
- Lint;
- Tests, including unit, architecture and HTTP integration tests through `scripts/ci/test.sh`;
- Build immutable artifact;
- CI evidence.

A previous failed execution was retained as useful audit evidence: the workflow originally passed `cache: false` to `actions/setup-node@v4`, which is not a supported cache value. The workflow was corrected and the subsequent execution passed instead of suppressing the failure.

## Immutable artifact evidence

Application artifact produced by the successful workflow:

```text
GitHub artifact id: 9474874462
artifact name: moventra-tms-459241c6a239ff9ae92b5f8817fd99407e44c49d
artifact archive digest: sha256:d64a12e7ccd7f41cfedeebb2024c2e904f0e8f19226e91a5c9a40746e7762186
expires: 2026-09-21
```

CI evidence artifact:

```text
GitHub artifact id: 9474875826
artifact name: ci-evidence-459241c6a239ff9ae92b5f8817fd99407e44c49d
artifact archive digest: sha256:14e7d541f22e59dff556ee0827f65aa7016d3ed5f159c5e75c6db829ea9f4eb3
expires: 2026-09-21
```

The application artifact was downloaded and independently inspected. It contains:

```text
api/health.js
build-manifest.json
package.json
src/core/health.js
src/http/request-handler.js
src/server.js
vercel.json
```

The packaged tarball is:

```text
moventra-tms-459241c6a239ff9ae92b5f8817fd99407e44c49d.tar.gz
```

Its internal SHA-256 is:

```text
9637aacd41703962679af2ac39ba19ee8ba1dc3bcd6aeff0e692b6965bdf716e
```

The calculated checksum matched the checksum emitted by the build. The build script was subsequently hardened so the `.sha256` file contains a portable basename and can be validated with `sha256sum -c` after extraction in any workspace.

## Evidence matrix

| Requirement | Status | Evidence |
|---|---|---|
| Executable application | EVIDENCED | PR #4 contains `src/server.js`, HTTP handler and `/health` |
| Lint | EVIDENCED | `Moventra CI` run `32569208155`, job `Lint`: success |
| Unit tests | EVIDENCED | run `32569208155`, `Tests`: success |
| Architecture tests | EVIDENCED | run `32569208155`, `Tests`: success |
| Integration tests | EVIDENCED | run `32569208155`, `Tests`: success |
| Security baseline | EVIDENCED | run `32569208155`, `Security baseline`: success |
| Build | EVIDENCED | run `32569208155`, `Build immutable artifact`: success |
| Immutable artifact | EVIDENCED | artifact `9474874462` + archive digest + internal SHA-256 independently verified |
| CI execution evidence | EVIDENCED | evidence artifact `9474875826` |
| Development/test deployment | EVIDENCED | Vercel project `moventra-tms`, deployment `dpl_HYdatwycPdDBuyrzwgpwUVgghC4i`, READY, `/health` HTTP 200 |
| Staging | EVIDENCED | Vercel project `moventra-tms-staging`, deployment `dpl_HJLskyLSEReNokhoMigzK7w1Zhvn`, READY, `/health` HTTP 200 |
| Staging verification workflow | IMPLEMENTED | `.github/workflows/release-gate.yml` validates `/health` under GitHub environment `staging` |
| Production approval mechanism | IMPLEMENTED / NOT PROTECTED | release gate uses GitHub environment `production`; required reviewer protection is not configured/evidenced yet |
| Rollback target identification | EVIDENCED | staging deployment `dpl_6HWgnpEZtQzSieR4uFfNLTTtX5Yx` retained as rollback candidate |
| Rollback candidate health | EVIDENCED | prior staging deployment `/health` returned HTTP 200 during validation |
| Rollback execution | BLOCKED | controlled traffic restoration to prior deployment has not been executed |
| Branch protection | BLOCKED | GitHub `main` reports `protected=false` and required status checks disabled |

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
validated deployment: dpl_HJLskyLSEReNokhoMigzK7w1Zhvn
previous deployment: dpl_6HWgnpEZtQzSieR4uFfNLTTtX5Yx
previous deployment rollback candidate: true
state: READY
health: HTTP 200
```

Deployment IDs are immutable revision identifiers and must be recorded in release evidence. Commit-to-artifact traceability remains a responsibility of the CI build manifest and must not be inferred only from a deployment URL.

## Release approval workflow

`.github/workflows/release-gate.yml` introduces the governed release boundary:

```text
workflow_dispatch
  -> staging environment
  -> staging /health verification
  -> rollback candidate /health verification
  -> production environment
  -> production approval evidence artifact
```

The workflow intentionally separates the *mechanism* from the *repository protection setting*. Merely declaring `environment: production` does not constitute approval protection. The GitHub `production` environment must still be configured with required reviewer protection before the phase gate can be approved.

## Remaining blockers

### B004-03 — Branch protection disabled

Observed repository state on `main`:

```text
protected=false
required_status_checks.enforcement_level=off
```

Required before gate approval:

- protect `main`;
- require pull request before merge;
- require the agreed status checks;
- require the defined review policy;
- prevent force push and branch deletion;
- govern any emergency bypass explicitly.

At minimum the ruleset must require the CI checks that protect repository contract, lint, tests, security, build and evidence.

### B004-04 — RESOLVED — GitHub Actions run evidenced

Resolved by successful `Moventra CI` run `32569208155`, plus application artifact `9474874462` and CI evidence artifact `9474875826`.

### B004-05 — Protected production approval not evidenced

The release workflow now uses GitHub environment `production`, but the environment protection rule itself is not configured/evidenced. A plain environment declaration is not sufficient.

Required before gate approval:

- configure required reviewer(s) on `production`;
- execute the release gate after staging validation;
- retain the resulting approval/run evidence.

### B004-06 — Rollback drill pending

A concrete prior staging deployment exists and is healthy, but traffic has not been deliberately restored to it and smoke-tested as a rollback exercise.

The currently connected Vercel team is on the Hobby plan. Vercel documents rollback to a specific previous deployment as a Pro/Enterprise feature. Therefore the official gate must not claim native Vercel rollback evidence under the current plan.

Acceptable production-grade resolution paths are:

1. move the deployment project to a Vercel plan that supports specific-deployment rollback and execute the drill; or
2. implement a provider-neutral rollback pipeline that redeploys the previously verified immutable Moventra artifact and then smoke-tests it.

Whichever path is adopted, the evidence must contain target artifact/deployment, actor, timestamp, reason, result and post-rollback smoke test.

## Current gate decision

**004 — CI/CD remains IN PROGRESS / BLOCKED.**

Major technical evidence is now complete: application, lint, tests, security baseline, deterministic build, immutable artifact, CI evidence, deploy/test and staging have all been materially exercised.

The phase remains blocked only by the controls that must be physically enforced rather than documented:

```text
branch protection on main
+
protected production approval execution
+
controlled rollback drill
```

Therefore:

```text
004 != CONCLUDED
G1 != APPROVED
005 != ACTIVE
```

Promotion to 005 is prohibited until those three remaining controls have concrete evidence.
