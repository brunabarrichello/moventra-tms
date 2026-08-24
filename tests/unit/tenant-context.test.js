import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTenantId } from '../../src/infrastructure/database/tenant-context.js';

const tenant='0198f1c0-4234-7abc-8def-0123456789ab';
test('tenant context accepts canonical UUID',()=>assert.equal(normalizeTenantId(tenant),tenant));
test('tenant context rejects arbitrary client strings',()=>assert.throws(()=>normalizeTenantId('tenant-a'),e=>e.code==='MVT_TENANT_CONTEXT_INVALID'));
