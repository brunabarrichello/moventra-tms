import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const classifier = fileURLToPath(
  new URL('../../scripts/release/classify-release-impact.sh', import.meta.url),
);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAll(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function classify(cwd, base, head) {
  const output = execFileSync('bash', [classifier, base, head], { cwd, encoding: 'utf8' });
  return Object.fromEntries(
    output.trim().split('\n').map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'moventra-release-impact-'));
  git(directory, 'init', '-q');
  git(directory, 'config', 'user.email', 'ci@example.invalid');
  git(directory, 'config', 'user.name', 'Moventra CI');
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(join(directory, 'src', 'server.js'), 'export const version = 1;\n');
  writeFileSync(join(directory, 'README.md'), '# Moventra\n');
  const base = commitAll(directory, 'base');
  return { directory, base };
}

test('documentation-only commit is classified without application release', () => {
  const { directory, base } = fixture();
  try {
    writeFileSync(join(directory, 'README.md'), '# Moventra\n\nDocumentation only.\n');
    mkdirSync(join(directory, 'docs', 'implementation'), { recursive: true });
    writeFileSync(join(directory, 'docs', 'implementation', 'checkpoint.md'), '# Checkpoint\n');
    const head = commitAll(directory, 'docs only');

    const result = classify(directory, base, head);
    assert.equal(result.requires_release, 'false');
    assert.equal(result.classification, 'documentation-only');
    assert.equal(result.runtime_file_count, '0');
    assert.equal(result.documentation_file_count, '2');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source-code change requires release', () => {
  const { directory, base } = fixture();
  try {
    writeFileSync(join(directory, 'src', 'server.js'), 'export const version = 2;\n');
    const head = commitAll(directory, 'runtime change');
    const result = classify(directory, base, head);

    assert.equal(result.requires_release, 'true');
    assert.equal(result.classification, 'runtime-impacting');
    assert.equal(result.runtime_file_count, '1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workflow change is release-impacting even when YAML is operational metadata', () => {
  const { directory, base } = fixture();
  try {
    mkdirSync(join(directory, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(directory, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    const head = commitAll(directory, 'workflow change');
    const result = classify(directory, base, head);

    assert.equal(result.requires_release, 'true');
    assert.equal(result.runtime_file_count, '1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting a runtime file still requires release', () => {
  const { directory, base } = fixture();
  try {
    rmSync(join(directory, 'src', 'server.js'));
    const head = commitAll(directory, 'delete runtime file');
    const result = classify(directory, base, head);

    assert.equal(result.requires_release, 'true');
    assert.equal(result.runtime_file_count, '1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
