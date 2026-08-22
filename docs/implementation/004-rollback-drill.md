# 004 — Rollback Drill Provider-Neutral

## Status atual

```text
prebuilt rollback mechanism   = IMPLEMENTED
artifact integrity validation = IMPLEMENTED
automatic previous-main lookup= IMPLEMENTED
physical rollback/restore     = EVIDENCED
revision-aware smoke          = EVIDENCED
retention                     = 90 days
```

A documentação histórica desta fase mencionava `180 days`; o workflow vigente foi posteriormente corrigido para `90 days`, compatível com a política atual do repositório público.

## Objective

Provide a reproducible rollback mechanism for Moventra TMS without depending on native provider rollback features. The drill deploys a previously verified prebuilt immutable artifact to staging, verifies its exact revision identity, then restores the current prebuilt artifact and verifies the restoration.

## Canonical flow

```text
successful staging evidence
-> resolve exact current artifact
-> resolve previous linear-main revision
-> require non-expired previous-main artifact
-> verify rollback artifact contract
-> verify restoration artifact contract
-> require different revisions
-> deploy rollback artifact to staging
-> verify rollback revision
-> restore current artifact even after eligible rollback failures
-> verify restored revision
-> persist rollback evidence
-> enforce all four outcomes as success
```

Mandatory final evidence values are:

```text
rollback_deploy=success
rollback_smoke=success
restore_deploy=success
restore_smoke=success
```

## Integrity rules

Eligible artifacts must satisfy the Moventra prebuilt contract, including:

```text
artifact_format=vercel-build-output-v3
build_output_api_version=3
runtime=nodejs22.x
```

Legacy source-package artifacts are historical evidence only and are not eligible for the current rollback path.

The workflow verifies checksum, manifest, artifact/revision identity and generated handler revision before deployment.

## Security and recovery

- staging credentials are supplied by the GitHub `staging` environment;
- GitHub Actions are pinned by immutable SHA;
- checkout does not persist credentials;
- automatic rollback candidate must be the single linear parent of the current revision;
- candidate artifact must originate from `main` with exact `head_sha`;
- restoration is attempted whenever credentials and restoration metadata are valid, even after eligible rollback failures;
- the final gate fails unless rollback and restoration deployment/smoke outcomes are all successful.

## Relation to Production Promotion

`Moventra Production Promotion` only accepts a successful Rollback Drill and re-validates the evidence produced by this workflow before production.

The production-remediation audit identified a later smoke defect in the production path, not a bypass of this rollback gate. See:

```text
docs/implementation/004-production-promotion-remediation-2026-08-22.md
```

## Gate rule

A rollback implementation or sequence of Vercel deployments by itself is not sufficient evidence. The authoritative promotion path relies on the generated rollback evidence artifact and the Production Promotion preflight.

Phase 004 remains open until a complete corrected production promotion succeeds and uploads the final production evidence artifact.
