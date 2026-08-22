# 004 — Rollback Drill Provider-Neutral

## Objective

Provide a reproducible rollback mechanism for Moventra TMS without depending on native provider rollback features. The drill deploys a previously verified **prebuilt immutable artifact** to staging, verifies its exact revision identity, then restores the current prebuilt artifact and verifies the restoration.

## Components

```text
.github/workflows/rollback-drill.yml
scripts/release/artifact-metadata.sh
scripts/release/vercel-deploy-artifact.sh
scripts/release/smoke-health.sh
```

## Artifact policy

Only artifacts with:

```text
artifact_format=vercel-build-output-v3
build_output_api_version=3
runtime=nodejs22.x
```

are eligible for the current rollback pipeline.

Legacy source-package artifacts produced before the build-once correction remain historical CI evidence but MUST NOT be used by this drill.

## Preconditions

GitHub environment `staging` must expose:

```text
secret: VERCEL_TOKEN
variable: VERCEL_ORG_ID
variable: VERCEL_STAGING_PROJECT_ID
```

Current observed identifiers:

```text
VERCEL_ORG_ID=team_3JTmWy5Z7vLfh2OqOwuFZp1G
VERCEL_STAGING_PROJECT_ID=prj_4USELVoAr0FsHg2vBNGXws7hU22Q
```

The token MUST be a GitHub secret and MUST NOT be committed.

## Drill inputs

```text
rollback_run_id
rollback_artifact_name
restore_run_id
restore_artifact_name
staging_url
```

The rollback and restoration artifacts MUST represent different commit SHAs. The workflow rejects a no-op drill where both revisions are identical.

## Verified prebuilt candidates

### Candidate A — rollback revision

```text
workflow: Moventra CI
run_id: 32574043439
run_number: 16
head_sha: a751429b3fb4074de94f216bb5203eea2e763c25
synthetic_merge_sha: e4d4d324b80f77d65f4a69f0e2c5aea644e41039
artifact_id: 9476076040
artifact_name: moventra-tms-e4d4d324b80f77d65f4a69f0e2c5aea644e41039
GitHub_archive_digest: sha256:cc74c10e219c4e186299e51ad7db3373a274fb8efaa2369fca3409384089bdd0
internal_tar_sha256: e3ebe421d14fa4dcad1b2abd86cbe135cc483ee9731a0b75711806796a7d1e9c
```

### Candidate B — restoration revision

```text
workflow: Moventra CI
run_id: 32574188764
run_number: 17
head_sha: 315a96b53c71a7230d2d374437f171494651b764
synthetic_merge_sha: 6624effd9e0b3e2d4bbdaf764b6b8997c278b1dd
artifact_id: 9476112190
artifact_name: moventra-tms-6624effd9e0b3e2d4bbdaf764b6b8997c278b1dd
GitHub_archive_digest: sha256:04f4b434c6283cd67cadc5778e7d1b0b2c46be115ae0d32857e14b375a78a0f6
internal_tar_sha256: 70ddb92c747bd669776de8308727bd47340f42bfc6ac161af0f820ca0fafad75
```

Both application artifacts were independently downloaded after their successful CI executions. For each one:

- `sha256sum -c` returned `OK`;
- `.vercel/output` was present;
- `build-manifest.json` declared `vercel-build-output-v3`;
- Build Output API version was `3`;
- runtime was `nodejs22.x`;
- the generated function handler physically embedded the manifest commit SHA.

The two candidates are distinct revisions and therefore satisfy the artifact-side precondition for a meaningful rollback drill.

## Execution flow

```text
workflow_dispatch
-> GitHub environment: staging
-> download rollback prebuilt artifact
-> download current restoration prebuilt artifact
-> validate credentials / project binding
-> verify rollback checksum, manifest and Build Output API contract
-> verify restoration checksum, manifest and Build Output API contract
-> require rollback SHA != restoration SHA
-> deploy rollback artifact with `vercel deploy --prebuilt --prod`
-> smoke deployment URL: /health.version == rollback SHA
-> smoke stable staging URL: /health.version == rollback SHA
-> redeploy current prebuilt artifact
-> smoke deployment URL: /health.version == restoration SHA
-> smoke stable staging URL: /health.version == restoration SHA
-> persist rollback evidence
-> fail gate if any mandatory rollback/restoration step failed
```

## Integrity rules

`artifact-metadata.sh` verifies before deployment:

- exactly one tarball and checksum;
- SHA-256 equality;
- manifest schema;
- product `Moventra TMS`;
- service `moventra-api`;
- 40-character revision SHA;
- artifact filename derived from that SHA;
- `artifact_format=vercel-build-output-v3`;
- Build Output API version 3;
- Node.js 22 function runtime;
- expected prebuilt files;
- revision SHA embedded in the generated handler;
- successful execution of the extracted health handler;
- handler output version equal to manifest SHA.

`vercel-deploy-artifact.sh` never rebuilds source. It extracts the verified artifact, binds it to the configured Vercel project and executes:

```text
vercel deploy --prebuilt --prod
```

## Recovery behavior

Restoration is attempted whenever:

- deployment credentials were successfully validated; and
- restoration artifact metadata was successfully validated.

This remains true even if the rollback deployment or rollback smoke later reports failure. The design avoids leaving staging intentionally changed merely because evidence collection failed after a deploy attempt.

## Revision-aware smoke test

A smoke test is successful only when all fields match:

```json
{
  "status": "ok",
  "product": "Moventra TMS",
  "service": "moventra-api",
  "version": "<expected-40-char-commit-sha>"
}
```

HTTP 200 alone is insufficient rollback evidence.

## Evidence generated

`evidence/rollback-drill.txt` records:

```text
workflow actor
workflow run ID / attempt
rollback source run
rollback GitHub artifact
rollback commit SHA
rollback artifact SHA-256
rollback deployment URL
rollback deploy outcome
rollback smoke outcome
restoration source run
restoration GitHub artifact
restoration commit SHA
restoration artifact SHA-256
restoration deployment URL
restoration deploy outcome
restoration smoke outcome
stable staging URL
```

The evidence artifact is retained for 180 days.

## Gate rule

The existence of this workflow and the two verified candidates are NOT rollback execution evidence by themselves.

`B004-06` can only be resolved after a real execution finishes with:

```text
rollback_deploy=success
rollback_smoke=success
restore_deploy=success
restore_smoke=success
```

and the generated evidence artifact is retained and referenced from the phase 004 audit record.

## Current status

```text
prebuilt rollback mechanism: IMPLEMENTED
artifact integrity verification: IMPLEMENTED
revision-aware smoke verification: IMPLEMENTED
first distinct prebuilt revision: EVIDENCED
second distinct prebuilt revision: EVIDENCED
physical rollback drill: PENDING
```

No promotion from 004 to 005 is authorized until the physical rollback drill and the other remaining 004 gates are evidenced.
