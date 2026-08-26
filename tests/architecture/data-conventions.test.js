import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const conventionsPath = path.join(root, 'docs/data/DATA-CONVENTIONS.md');
const migrationsDirectory = path.join(root, 'db/migrations');

const snakeCaseIdentifier = /^[a-z][a-z0-9_]*$/;
const sqlExpressionKeywords = new Set(['and', 'between', 'in', 'is', 'not', 'or']);

function sqlCodeLines(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean);
}

function assertQualifiedSnakeCase(identifier, context) {
  for (const part of identifier.split('.')) {
    assert.match(part, snakeCaseIdentifier, `${context}: invalid SQL identifier ${identifier}`);
  }
}

test('canonical data conventions contain every phase 007 contract', async () => {
  const document = await readFile(conventionsPath, 'utf8');

  const requiredSections = [
    '## 1. Identificadores',
    '## 2. Nomenclatura PostgreSQL',
    '## 3. Multi-tenancy e escopo organizacional',
    '## 4. Datas, horários e fusos',
    '## 5. Valores monetários e moeda',
    '## 6. Exclusão, histórico, retenção e LGPD',
    '## 7. Concorrência, integridade e idempotência',
    '## 8. Estados, enums e máquinas de estado',
    '## 9. Índices e performance',
    '## 11. Regras de migration',
    '## 12. Validação automatizada',
    '## 14. Decisões congeladas pela fase 007',
  ];

  for (const section of requiredSections) {
    assert.ok(document.includes(section), `missing canonical section: ${section}`);
  }

  const requiredContractTokens = [
    'uuidv7()',
    'TIMESTAMPTZ / UTC',
    'NUMERIC(19,4)',
    'ISO 4217',
    'tenant_id UUID NOT NULL',
    'version BIGINT',
    'append-only',
    'state machine',
    'forward-fix',
  ];

  for (const token of requiredContractTokens) {
    assert.ok(document.includes(token), `missing phase 007 contract token: ${token}`);
  }
});

test('SQL migrations obey machine-checkable data conventions', async () => {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  assert.ok(migrationFiles.length > 0, 'at least one migration is required');

  for (const filename of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    const lines = sqlCodeLines(sql);

    for (const line of lines) {
      assert.doesNotMatch(
        line,
        /^\w+\s+(?:smallserial|serial|bigserial)\b/i,
        `${filename}: SERIAL identity types are forbidden by DATA-CONVENTIONS.md`,
      );
      assert.doesNotMatch(
        line,
        /^\w+\s+money\b/i,
        `${filename}: PostgreSQL MONEY is forbidden by DATA-CONVENTIONS.md`,
      );

      const tableMatch = /^create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z0-9_.]+)/i.exec(line);
      if (tableMatch) {
        assertQualifiedSnakeCase(tableMatch[1], `${filename} CREATE TABLE`);
      }

      const constraintMatch = /^constraint\s+([a-z0-9_]+)/i.exec(line);
      if (constraintMatch) {
        assert.match(
          constraintMatch[1],
          snakeCaseIdentifier,
          `${filename}: constraint names must be snake_case`,
        );
      }

      const timestampMatch = /^([a-z][a-z0-9_]*_at)\s+([a-z][a-z0-9_]*(?:\([^)]*\))?)(?:\s|,|$)/i.exec(line);
      if (timestampMatch && !sqlExpressionKeywords.has(timestampMatch[2].toLowerCase())) {
        assert.match(
          timestampMatch[2],
          /^timestamptz\b/i,
          `${filename}: ${timestampMatch[1]} must use TIMESTAMPTZ`,
        );
      }

      const amountMatch = /^([a-z][a-z0-9_]*_amount)\s+(.+)$/i.exec(line);
      if (amountMatch) {
        assert.match(
          amountMatch[2],
          /^(?:numeric|decimal)\s*\(/i,
          `${filename}: ${amountMatch[1]} must use NUMERIC/DECIMAL with explicit precision`,
        );
      }

      const tenantMatch = /^tenant_id\s+(.+)$/i.exec(line);
      if (tenantMatch) {
        assert.match(tenantMatch[1], /^uuid\b/i, `${filename}: tenant_id must use UUID`);
        assert.match(
          tenantMatch[1],
          /\bnot\s+null\b/i,
          `${filename}: tenant_id must be NOT NULL when present`,
        );
      }

      const uuidDefaultMatch = /^id\s+uuid\b(.+)$/i.exec(line);
      if (uuidDefaultMatch && /\bdefault\b/i.test(uuidDefaultMatch[1])) {
        assert.match(
          uuidDefaultMatch[1],
          /\bdefault\s+uuidv7\s*\(\s*\)/i,
          `${filename}: database-generated UUID primary ids must use uuidv7()`,
        );
      }
    }
  }
});
