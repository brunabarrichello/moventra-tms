# 004 — Rollback Drill Provider-Neutral

## Objective

Provide a reproducible rollback mechanism for Moventra TMS that does not depend on native rollback support from the hosting plan. The procedure restores a previously verified immutable application artifact into the staging project, validates it, and then restores the current artifact.

## Components

```text
.github/workflows/rollback-drill.yml
scripts/release/vercel-deploy-artifact.sh
```

## Preconditions

GitHub environment `staging` must contain or expose the following deployment configuration:

```text
secret: VERCEL_TOKEN
variable: VERCEL_ORG_ID
variable: VERCEL_STAGING_PROJECT_ID
```

Current observed identifiers for the connected staging project are:

```text
VERCEL_ORG_ID=team_3JTmWy5Z7vLfh2OqOwuFZp1G
VERCEL_STAGING_PROJECT_ID=prj_4USELVoAr0FsHg2vBNGXws7hU22Q
```

The token MUST be stored as a GitHub secret and MUST NOT be committed to the repository.

## Drill inputs

The workflow requires:

```text
rollback_run_id
rollback_artifact_name
restore_run_id
restore_artifact_name
staging_url
```

A valid rollback source already exists from CI run `32569208155`:

```text
rollback_run_id=32569208155
rollback_artifact_name=moventra-tms-459241c6a239ff9ae92b5f8817fd99407e44c49d
```

A current restoration source must always be selected from the latest successful `Moventra CI` execution before running the drill.

## Execution flow

```text
workflow_dispatch
  -> GitHub environment: staging
  -> download rollback immutable artifact
  -> download current immutable artifact
  -> verify SHA-256 of rollback artifact
  -> verify build-manifest.json
  -> redeploy rollback artifact to moventra-tms-staging
  -> smoke test deployment URL /health
  -> smoke test stable staging URL /health
  -> redeploy current immutable artifact
  -> smoke test restored deployment URL /health
  -> smoke test stable staging URL /health
  -> persist rollback evidence artifact
  -> fail workflow if any deploy/smoke step failed
```

## Integrity rules

The deploy adapter validates:

- exactly one Moventra tarball and checksum file;
- SHA-256 digest before extraction;
- `product = Moventra TMS` in `build-manifest.json`;
- `service = moventra-api`;
- 40-character commit SHA;
- immutable artifact naming convention;
- explicit Vercel project binding through `.vercel/project.json` generated at runtime.

The script intentionally accepts the earlier checksum format that contained a workspace-relative path by comparing the expected digest value directly with the downloaded tarball digest. New artifacts use the portable basename format.

## Evidence generated

Each drill writes `evidence/rollback-drill.txt` and uploads it with 90-day retention. Evidence includes:

```text
actor
workflow run ID / attempt
rollback source run
rollback artifact
rollback deployment URL
rollback deploy outcome
rollback smoke outcome
restore source run
restore artifact
restore deployment URL
restore deploy outcome
restore smoke outcome
stable staging URL
```

## Gate rule

The existence of this workflow is NOT rollback evidence by itself.

`B004-06` may only be marked resolved after a real workflow execution finishes successfully with:

```text
rollback_deploy=success
rollback_smoke=success
restore_deploy=success
restore_smoke=success
```

and the generated evidence artifact is retained and referenced from the 004 audit record.

## Security

- `VERCEL_TOKEN` is secret-only and must never appear in logs or repository content.
- Deployment targets are pinned by project ID rather than inferred from user input.
- The workflow is serialized through a staging rollback concurrency group.
- The current artifact is always downloaded before rollback starts, preserving the recovery path.
- Restoration runs with `if: always()` after a successful rollback deployment so a failed rollback smoke test does not leave staging intentionally pinned to the rollback revision without an attempted recovery.

## Current status

```text
mechanism: IMPLEMENTED
local artifact validation: PASSED
CI lint/test/build validation: PASSED
physical rollback drill: PENDING
```

The drill remains blocked on deployment credential configuration and workflow execution. This does not authorize promotion from 004 to 005.
