import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('authorized tenant operation composes canonical security primitives inside tenant transaction', () => {
  const source = read('src/modules/security/authorized-tenant-operation.js');

  assert.match(source, /withTenantDatabaseTransaction/);
  assert.match(source, /AuthIdentityResolver/);
  assert.match(source, /AuthorizationService/);
  assert.match(source, /PostgresOrganizationalScopeRepository/);
  assert.match(source, /PostgresAuditRepository/);
  assert.match(source, /verifiedAssertion/);
  assert.match(source, /MVT_SCOPE_FORBIDDEN/);
  assert.match(source, /outcome: 'SUCCESS'/);
  assert.match(source, /'DENIED'/);
  assert.match(source, /'FAILED'/);
  assert.doesNotMatch(source, /authorizationHeader|rawClaims|x-user-id|x-tenant-id/i);
});

test('database CI executes integrated security pipeline using runtime app role', () => {
  const workflow = read('.github/workflows/ci.yml');
  const validation = read('scripts/db/validate-security-pipeline.mjs');

  assert.match(workflow, /Validate integrated Auth-RBAC-Scope-RLS-Audit pipeline/);
  assert.match(workflow, /node scripts\/db\/validate-security-pipeline\.mjs/);
  assert.match(validation, /SET LOCAL ROLE/);
  assert.match(validation, /moventra_app_ci/);
  assert.match(validation, /NOBYPASSRLS|rolbypassrls/);
  assert.match(validation, /MVT_RBAC_FORBIDDEN/);
  assert.match(validation, /MVT_SCOPE_FORBIDDEN/);
  assert.match(validation, /Tenant B must be invisible/);
});

test('automatic release workflows classify impact before deploy gates', () => {
  const releaseGate = read('.github/workflows/release-gate.yml');
  const rollback = read('.github/workflows/rollback-drill.yml');
  const production = read('.github/workflows/production-promotion.yml');

  for (const workflow of [releaseGate, rollback, production]) {
    assert.match(workflow, /Classify release impact/);
    assert.match(workflow, /classify-release-impact\.sh/);
    assert.match(workflow, /requires_release/);
    assert.match(workflow, /manual-release/);
  }

  assert.match(releaseGate, /staging:\n\s+name: Staging prebuilt deployment\n\s+needs: impact/);
  assert.match(rollback, /rollback-drill:\n\s+name: Provider-neutral prebuilt rollback drill\n\s+needs: impact/);
  assert.match(production, /preflight:\n\s+name: Production fail-closed preflight\n\s+needs: impact/);
  assert.match(production, /environment:\n\s+name: production/);
  assert.match(production, /Capture authoritative environment approval/);
});

test('release impact classifier is fail-closed outside explicit documentation paths', () => {
  const classifier = read('scripts/release/classify-release-impact.sh');

  assert.match(classifier, /docs\/\*/);
  assert.match(classifier, /README\.md/);
  assert.match(classifier, /--diff-filter=ACDMRTUXB/);
  assert.match(classifier, /requires_release=true/);
  assert.match(classifier, /runtime-impacting/);
  assert.match(classifier, /\[\[ "\$file" != \*\/\* \]\]/);
});

test('P1 hardening remains distinct from phase 018 and preserves protected Production', () => {
  const doc = read('docs/security/P1-POST-G2-HARDENING.md');

  assert.match(doc, /hardening\/revalidação do G2/i);
  assert.match(doc, /não ativa a fase 018/i);
  assert.match(doc, /verified provider assertion/);
  assert.match(doc, /Production somente for promovida após gate humano explícito/i);
  assert.match(doc, /documentation-only/);
  assert.match(doc, /runtime-impacting/);
});
