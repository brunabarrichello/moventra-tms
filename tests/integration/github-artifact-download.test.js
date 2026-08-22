import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const downloader = path.join(root, 'scripts/release/github-download-artifact.sh');

function runProcess(command, args, { env = {}, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => { resolve({ code, signal, stdout, stderr }); });
  });
}

test('REST artifact downloader validates archive digest and extracts exactly one selected artifact', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'moventra-artifact-rest-'));
  const bin = path.join(temp, 'bin');
  const fixtureZip = path.join(temp, 'artifact.zip');
  const destination = path.join(temp, 'downloaded');
  const callsLog = path.join(temp, 'curl-calls.txt');

  await runProcess('mkdir', ['-p', bin]);
  const zipResult = await runProcess('python3', [
    '-c',
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); z.writestr('payload.txt','moventra-ok\\n'); z.close()",
    fixtureZip,
  ]);
  assert.equal(zipResult.code, 0, zipResult.stderr);

  const digestResult = await runProcess('sha256sum', [fixtureZip]);
  assert.equal(digestResult.code, 0, digestResult.stderr);
  const digest = digestResult.stdout.split(/\s+/)[0];
  assert.match(digest, /^[0-9a-f]{64}$/);

  const mockCurl = path.join(bin, 'curl');
  await writeFile(mockCurl, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALLS_LOG"
output=''
url=''
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  case "\${args[$i]}" in
    --output)
      output="\${args[$((i+1))]}"
      i=$((i+1))
      ;;
    http*) url="\${args[$i]}" ;;
  esac
done
list_url="\${GITHUB_API_URL}/repos/\${GITHUB_REPOSITORY}/actions/runs/123/artifacts?per_page=100"
archive_url="\${GITHUB_API_URL}/repos/\${GITHUB_REPOSITORY}/actions/artifacts/42/zip"
if [[ "$url" == "$list_url" ]]; then
  cat <<JSON
{"total_count":1,"artifacts":[{"id":42,"name":"moventra-tms-test","expired":false,"archive_download_url":"$archive_url","digest":"sha256:\${FIXTURE_DIGEST}"}]}
JSON
  exit 0
fi
if [[ "$url" == "$archive_url" ]]; then
  test -n "$output"
  cp "$FIXTURE_ZIP" "$output"
  exit 0
fi
printf 'unexpected mock curl URL: %s\\n' "$url" >&2
exit 22
`);
  await chmod(mockCurl, 0o755);

  try {
    const result = await runProcess('bash', [downloader, '123', 'exact', 'moventra-tms-test', destination], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GH_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_API_URL: 'https://api.github.test',
        RUNNER_TEMP: temp,
        FIXTURE_ZIP: fixtureZip,
        FIXTURE_DIGEST: digest,
        CALLS_LOG: callsLog,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /artifact_id=42/);
    assert.match(result.stdout, /artifact_name=moventra-tms-test/);
    assert.match(result.stdout, new RegExp(`archive_sha256=${digest}`));
    assert.equal(await readFile(path.join(destination, 'payload.txt'), 'utf8'), 'moventra-ok\n');

    const calls = await readFile(callsLog, 'utf8');
    assert.match(calls, /actions\/runs\/123\/artifacts\?per_page=100/);
    assert.match(calls, /actions\/artifacts\/42\/zip/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
