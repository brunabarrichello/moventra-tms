# 004 — CI/CD

## Status

- Official repository: `brunabarrichello/moventra-tms`
- Specification: defined
- Physical implementation: substantially implemented
- CI validation: evidenced
- Build-once / prebuilt artifact architecture: implemented and CI-validated
- Prebuilt staging / rollback / production execution: pending
- Gate: IN PROGRESS / BLOCKED
- Promotion to `005 — Secrets Management`: NOT AUTHORIZED

## Objective

Establish an automated, reproducible and auditable delivery pipeline for Moventra TMS with evidence tied to repository, commit, actor, immutable artifact and deployment revision.

The official delivery invariant is:

```text
build once
-> verify once
-> immutable prebuilt artifact
-> deploy the exact artifact to staging
-> verify exact revision identity
-> protected production approval
-> deploy the same artifact to production
-> verify exact revision identity
```

No environment is allowed to rebuild application source during promotion.

## Repository rename

The repository was renamed from `brunabarrichello/moventra-github` to:

```text
brunabarrichello/moventra-tms
```

The repository identity, issues, PR #4 and commit history were preserved. All new evidence must use the new repository name.

## Executable foundation

PR #4 (`phase/004-cicd-completion`) contains:

- executable `moventra-api` foundation on Node.js 22.x;
- `/health` endpoint;
- unit tests;
- architecture dependency tests;
- HTTP integration tests;
- repository-owned lint/static-analysis, test and build hooks;
- security baseline;
- deterministic artifact packaging;
- Vercel Build Output API v3 generator;
- immutable artifact name tied to the GitHub Actions execution SHA;
- portable SHA-256 checksum;
- build manifest with revision and deployment format;
- artifact contract verifier that executes the extracted prebuilt handler;
- revision-aware smoke test;
- release gate for staging -> protected production;
- provider-neutral rollback drill using prebuilt artifacts.

Stable contracts:

```text
scripts/ci/lint.sh
scripts/ci/test.sh
scripts/ci/build.sh
scripts/ci/build-vercel-output.mjs
scripts/release/artifact-metadata.sh
scripts/release/vercel-deploy-artifact.sh
scripts/release/smoke-health.sh
```

## Build-once artifact architecture

The current build no longer packages repository source as the deployable unit. It generates the Vercel Build Output API directly under:

```text
.vercel/output/
```

The immutable tarball contains only the deployment output plus `build-manifest.json`.

Expected artifact layout:

```text
build-manifest.json
.vercel/output/config.json
.vercel/output/functions/api/health.func/.vc-config.json
.vercel/output/functions/api/health.func/index.js
.vercel/output/functions/api/health.func/package.json
.vercel/output/functions/api/health.func/src/core/health.js
```

The function handler embeds the build commit SHA. Therefore `/health.version` is part of the deployment identity and can be checked against the manifest during staging, rollback and production smoke tests.

### Manifest contract

```json
{
  "schema_version": 1,
  "product": "Moventra TMS",
  "service": "moventra-api",
  "commit_sha": "<40-char-sha>",
  "artifact": "moventra-tms-<sha>.tar.gz",
  "artifact_format": "vercel-build-output-v3",
  "build_output_api_version": 3,
  "runtime": "nodejs22.x"
}
```

Before deployment, `artifact-metadata.sh` verifies:

- exactly one immutable tarball and checksum;
- SHA-256 integrity;
- manifest schema and product/service identity;
- artifact name <-> commit SHA consistency;
- Build Output API v3 structure;
- Node.js 22 runtime contract;
- commit SHA embedded in the generated function;
- extracted handler execution;
- `/health` payload identity and cache policy.

## Current CI evidence — prebuilt architecture

The build-once correction was introduced by branch commit:

```text
head commit: a751429b3fb4074de94f216bb5203eea2e763c25
message: 004: enforce build-once prebuilt CD architecture
```

GitHub pull-request workflows executed against synthetic merge SHA:

```text
e4d4d324b80f77d65f4a69f0e2c5aea644e41039
```

Successful executions:

```text
Foundation CI
run_id: 32574043449
run_number: 21
result: success

Moventra CI
run_id: 32574043439
run_number: 16
result: success
```

Successful `Moventra CI #16` jobs:

- Repository contract;
- Lint, including static architecture analysis;
- Tests, including unit, architecture and HTTP integration tests;
- Security baseline;
- Build immutable artifact;
- CI evidence.

### First verified prebuilt artifact

```text
GitHub artifact id: 9476076040
GitHub artifact name: moventra-tms-e4d4d324b80f77d65f4a69f0e2c5aea644e41039
GitHub archive digest: sha256:cc74c10e219c4e186299e51ad7db3373a274fb8efaa2369fca3409384089bdd0
internal tar SHA-256: e3ebe421d14fa4dcad1b2abd86cbe135cc483ee9731a0b75711806796a7d1e9c
```

CI evidence artifact:

```text
artifact id: 9476077271
name: ci-evidence-e4d4d324b80f77d65f4a69f0e2c5aea644e41039
digest: sha256:7662b6745d952f422c52582b2e9156252b2e0afcc1afb5140a43527722a86821
```

The application artifact was independently downloaded after the CI run. `sha256sum -c` returned `OK`, the prebuilt directory structure was inspected, the manifest matched the synthetic execution SHA, and the same SHA was physically present in the generated function handler.

This is the first artifact eligible for the new prebuilt rollback mechanism.

## Legacy artifact evidence

Artifacts generated before the build-once correction remain valid historical CI evidence, but they packaged source for a later Vercel build. They are therefore classified as:

```text
LEGACY_SOURCE_ARTIFACT
```

They MUST NOT be used as rollback or production artifacts by the new CD pipeline.

The old deployment IDs remain useful historical evidence that the foundation application was physically deployable:

```text
moventra-tms:
  dpl_HYdatwycPdDBuyrzwgpwUVgghC4i

moventra-tms-staging:
  dpl_HJLskyLSEReNokhoMigzK7w1Zhvn
  previous: dpl_6HWgnpEZtQzSieR4uFfNLTTtX5Yx
```

Those deployments do not by themselves prove the new prebuilt promotion path.

## Lint / static analysis

The `Lint` check name is intentionally preserved so existing repository protection is not broken while the check becomes stronger.

It now performs:

- JavaScript and MJS syntax validation across `src`, `api`, `tests` and `scripts`;
- shell syntax validation;
- trailing whitespace rejection;
- rejection of dynamic `eval` / `new Function` in application code;
- architecture tests, including Build Output API contract generation.

Deeper dependency and security analysis remains evolvable without changing the required status-check name.

## Branch protection

The current GitHub branch resource reports:

```text
main.protected = true
```

Therefore the previous audit statement `protected=false` is obsolete and must not be used as current evidence.

Branch protection existence is now evidenced. Review-count policy, direct required-check selection, bypass governance and production-environment reviewers remain administrative policy concerns and must be evaluated separately from the boolean protected state.

## Release gate

`.github/workflows/release-gate.yml` now implements an actual promotion pipeline rather than a digest-recording-only workflow.

```text
workflow_dispatch
-> download immutable artifact from a specific GitHub Actions run
-> verify checksum + manifest + prebuilt contract
-> deploy exact artifact to staging with `vercel deploy --prebuilt --prod`
-> smoke deployment URL and stable staging URL
-> require `/health.version == manifest.commit_sha`
-> persist staging evidence
-> enter GitHub environment `production`
-> protected approval must occur before production job executes
-> download and re-verify the SAME artifact
-> require staging commit and artifact digest equality
-> deploy exact prebuilt artifact to production
-> smoke deployment URL and stable production URL
-> persist production evidence
```

The evidence file records `workflow_actor` only as the workflow initiator. It does not mislabel `GITHUB_ACTOR` as the environment reviewer. The canonical reviewer identity must come from GitHub's protected-environment deployment review evidence.

### Required deployment configuration

GitHub `staging` environment:

```text
secret: VERCEL_TOKEN
variable: VERCEL_ORG_ID
variable: VERCEL_STAGING_PROJECT_ID
```

GitHub `production` environment:

```text
secret: VERCEL_TOKEN
variable: VERCEL_ORG_ID
variable: VERCEL_PRODUCTION_PROJECT_ID
required reviewer(s): REQUIRED
```

Observed project identifiers:

```text
VERCEL_ORG_ID=team_3JTmWy5Z7vLfh2OqOwuFZp1G
VERCEL_STAGING_PROJECT_ID=prj_4USELVoAr0FsHg2vBNGXws7hU22Q
VERCEL_PRODUCTION_PROJECT_ID=prj_5qFenjyeGE1joaGomaNrUIRGSBQs
```

`VERCEL_TOKEN` must never be committed.

## Rollback gate

The rollback drill is now prebuilt-only.

```text
previous verified prebuilt artifact
-> verify checksum / manifest / revision
-> deploy exact prebuilt to staging
-> verify deployment + stable alias return rollback SHA
-> deploy current verified prebuilt artifact
-> verify deployment + stable alias return restoration SHA
-> persist evidence
```

The workflow requires rollback and restoration revisions to differ. If rollback deployment is attempted and a later rollback step fails, restoration is still attempted whenever deployment credentials and restoration metadata are valid.

The first rollback candidate under the new format is the artifact from `Moventra CI #16`. A second distinct prebuilt artifact is required before the physical drill can be meaningful.

## Workflow-dispatch sequencing

`release-gate.yml` and `rollback-drill.yml` use `workflow_dispatch`. Their governed manual execution is expected after the workflows exist on the default branch.

This removes the earlier circular rule that incorrectly required the manual release/rollback workflows to execute before the PR containing them could be merged.

The correct separation is:

```text
PR CI green
-> merge under protected main policy
-> CI on final main commit
-> select final main prebuilt artifact
-> staging prebuilt deployment
-> controlled rollback drill
-> protected production approval
-> production prebuilt deployment
-> final 004 evidence
```

Merging PR #4 does NOT by itself conclude phase 004.

## Evidence matrix

| Requirement | Status | Current evidence |
|---|---|---|
| Executable application | EVIDENCED | `moventra-api`, `/health` |
| Lint / static analysis | EVIDENCED | `Moventra CI #16` |
| Unit tests | EVIDENCED | `Moventra CI #16` |
| Architecture tests | EVIDENCED | dependency + Build Output API tests |
| Integration tests | EVIDENCED | HTTP integration tests |
| Security baseline | EVIDENCED | `Moventra CI #16` |
| Deterministic packaging | EVIDENCED | deterministic tar/gzip + checksum |
| Build-once prebuilt artifact | EVIDENCED | artifact `9476076040` |
| Artifact contract / embedded revision | EVIDENCED | independent artifact inspection |
| CI evidence | EVIDENCED | artifact `9476077271` |
| `main` protected | EVIDENCED | GitHub reports `protected=true` |
| Historical dev/test deploy | EVIDENCED | existing Vercel READY deployment |
| Historical staging deploy | EVIDENCED | existing Vercel READY deployments |
| Automated prebuilt staging deploy | PENDING PHYSICAL EXECUTION | release gate implemented |
| Revision-aware staging smoke | PENDING PHYSICAL EXECUTION | smoke script implemented |
| Controlled prebuilt rollback drill | PENDING PHYSICAL EXECUTION | workflow implemented; second revision required |
| Protected production reviewer policy | NOT YET EVIDENCED | administrative configuration required |
| Protected production deploy | PENDING PHYSICAL EXECUTION | release gate implemented |

## Remaining blockers

### B004-05 — Protected production approval not evidenced

Required:

- configure GitHub `production` environment with required reviewer(s);
- preserve GitHub environment/deployment review evidence;
- execute the protected production job using the exact artifact validated in staging.

### B004-06 — Prebuilt rollback drill pending

Required:

- retain two distinct verified prebuilt artifacts;
- execute rollback on staging;
- verify rollback SHA at deployment URL and stable staging URL;
- restore current artifact;
- verify restoration SHA at both URLs;
- retain rollback evidence artifact.

### B004-07 — Prebuilt CD execution pending

Required:

- merge the validated workflow to protected `main` when repository policy permits;
- use the CI artifact produced from the final `main` commit as the release artifact;
- execute staging and production deployment from that immutable prebuilt artifact without rebuilding.

## Current gate decision

**004 — CI/CD remains IN PROGRESS / BLOCKED.**

The architecture defects identified in the review have been corrected in code and validated by CI. The remaining work is now primarily governed execution and administrative protection rather than artifact design.

Therefore:

```text
004 != CONCLUDED
G1 != APPROVED
005 != ACTIVE
```

The next permissible sequence is to validate this documentation commit, merge PR #4 under the active `main` protection, obtain the final `main` prebuilt artifact, and only then execute staging, rollback, protected approval and production gates.
