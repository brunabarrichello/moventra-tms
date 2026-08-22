# 004 — CI/CD

## Status

- Specification: defined
- Physical implementation: partial
- Validation: pending
- Gate: blocked
- Macro gate: G1 — Foundation Ready

## Objective

Establish an automated, reproducible and auditable delivery pipeline for Moventra TMS, preserving the official execution order and producing evidence tied to repository, commit, actor and pipeline run.

## Implemented in this phase

The repository now contains a GitHub Actions foundation workflow with:

- pull request, `main` push and manual triggers;
- read-only default token permissions;
- concurrency control with cancellation of superseded runs;
- mandatory repository-contract checks;
- rejection of tracked `.env` files, except sanitized `.env.example`;
- rejection of high-risk tracked credential/key file types;
- repository-owned hooks for future lint, tests and build;
- immutable execution evidence containing repository, commit SHA, ref, run ID, run attempt, actor and control results;
- uploaded CI evidence artifact with finite retention.

## Expected application hooks

When the application skeleton exists, the following executable hooks become the stable CI contract independent of the concrete implementation technology:

```text
scripts/ci/lint.sh
scripts/ci/test.sh
scripts/ci/build.sh
```

These hooks must encapsulate framework-specific commands without coupling the workflow to a temporary stack decision.

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

## Evidence required to approve the phase gate

The phase MUST NOT be marked concluded until all items below have concrete evidence:

1. GitHub Actions workflow executes successfully on a pull request.
2. Application lint/static-analysis hook exists and passes.
3. Unit/architecture/integration test hooks exist and pass.
4. Application build hook exists and produces an immutable artifact tied to a commit SHA.
5. Deployment target for development/test is physically configured.
6. Staging promotion is reproducible.
7. Production promotion requires an explicit protected-environment approval policy.
8. Rollback procedure identifies the exact previously deployed artifact.
9. Branch protection on `main` requires the agreed status checks and review policy.
10. CI execution logs/artifacts can be traced to commit and actor.

## Current blockers

### B004-01 — Application skeleton absent

The official repository currently contains project documentation only; therefore there is no executable application to lint, test or build.

Impact: the build-once and artifact requirements cannot yet be evidenced.

### B004-02 — Moventra Vercel project absent

The connected Vercel team currently has projects for previous repositories, but no project linked to `brunabarrichello/moventra-github`.

Impact: development/test/staging deployment cannot yet be evidenced for Moventra.

### B004-03 — Branch protection not evidenced

The current connector allows repository and CI operations but does not expose a branch-protection write action in this execution context.

Impact: required checks/review enforcement on `main` remains an external repository setting to be evidenced before gate approval.

## Gate decision

**004 — CI/CD remains IN PROGRESS / BLOCKED.**

The foundation workflow is implemented, but the official gate is not approved because an executable application artifact and a Moventra deployment target do not yet exist.

No dependent phase is promoted as concluded while this gate remains blocked.
