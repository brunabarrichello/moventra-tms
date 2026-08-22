# 004 — CI/CD

## Status

- Official repository: `brunabarrichello/moventra-tms`
- Specification: defined
- Physical implementation: substantially implemented
- CI validation: evidenced
- Build-once / prebuilt artifact architecture: implemented and CI-validated
- Prebuilt staging / rollback execution: evidenced
- Production deploy of revision `4575ffefce63b2bc2b75e6e9985a2b30c40b383b`: physically evidenced
- Protected production promotion: remediation validated; successful full re-execution still required
- Gate: IN PROGRESS / REMEDIATED / REEXECUTION REQUIRED
- Promotion to `005 — Secrets Management`: NOT AUTHORIZED

> Authoritative current-state records:
> - `docs/implementation/004-current-state-audit-2026-08-22.md`
> - `docs/implementation/004-production-promotion-remediation-2026-08-22.md`
>
> Historical evidence and design detail remain available in Git history and the phase issues/PRs. The current decision is conservative: the original protected production run physically deployed the exact artifact but finished with `failure` during the protected-alias smoke and therefore did not upload the final production evidence artifact.

## Objective

Establish an automated, reproducible and auditable delivery pipeline for Moventra TMS with evidence tied to repository, commit, actor, immutable artifact and deployment revision.

The official delivery invariant is:

```text
build once
-> verify once
-> immutable prebuilt artifact
-> deploy the exact artifact to staging
-> verify exact revision identity
-> rollback/restore drill
-> protected production approval
-> deploy the same artifact to production
-> verify immutable deployment and stable production revision identity
-> persist approval history + production evidence
```

No environment is allowed to rebuild application source during promotion.

## Current production-remediation finding

The automatic Production Promotion run `32581944193` proved all of the following before failing:

```text
Production fail-closed preflight      success
Protected environment approval       success
Exact main revision checkout         success
Exact rollback-proven artifact       success
Artifact re-verification             success
Prebuilt production deploy           success
Immutable source SHA                 4575ffefce63b2bc2b75e6e9985a2b30c40b383b
Internal artifact SHA-256            65d2edc3c73bcd49d4bff7a4833bdf85958eaaea8e94f4fa481bc943a7e2d3a8
Vercel deployment                    dpl_HCh9jAeUNvD3FeSkeLB8TP48wkVv
Public production smoke              success
Protected secondary-alias smoke      failure
Production evidence upload           skipped
Run conclusion                       failure
```

The smoke failure was not an application revision failure. The protected alias redirected anonymous traffic to Vercel SSO; the old smoke followed that redirect and passed the large response through an environment variable to Node, causing `Argument list too long`.

The remediation now:

- validates response JSON via stdin;
- does not follow anonymous authentication redirects;
- falls through to authenticated Vercel smoke in `auto` mode;
- preserves exact product/service/SHA checks;
- preserves the immutable Vercel deployment URL rather than replacing it with a mutable alias;
- includes regression tests for SSO redirects, large bodies and URL parsing.

## Gate rule

The earlier production deploy is valid physical evidence but is **not sufficient to conclude 004**, because the workflow itself ended in `failure` and the final `production-deployment-<sha>` evidence artifact was not emitted.

A new canonical `main` execution must complete:

```text
Moventra CI
-> staging promotion
-> rollback/restore
-> protected production preflight
-> human environment approval
-> exact same artifact deploy
-> immutable deployment smoke
-> stable production smoke
-> production evidence artifact
-> approval-history.json
```

Only then:

```text
004 = CONCLUDED
005 = ACTIVE
```

`G1 — Foundation Ready` remains dependent on later foundation phases, including Secrets Management and Banco Base.
