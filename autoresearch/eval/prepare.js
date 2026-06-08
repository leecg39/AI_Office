#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function countPattern(files, pattern) {
  let total = 0;
  for (const f of files) {
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf8');
    const matches = content.match(new RegExp(pattern, 'g'));
    total += matches ? matches.length : 0;
  }
  return total;
}

function runCmd(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    return 1;
  } catch {
    return 0;
  }
}

const srcFiles = ['src/extension.ts', 'src/agents.ts', 'src/paths.ts', 'src/system-specs.ts'];
const serverFiles = ['scripts/web-server.js', 'src/extension.ts'];

const metrics = {
  compile_ok: runCmd('npm run compile'),
  web_check_ok: runCmd('npm run web:check'),
  any_count: countPattern(srcFiles, ' as any|: any'),
  ignore_catch_count: countPattern(srcFiles, 'catch\\s*\\{\\s*(?:/\\*[\\s\\S]*?\\*/)?\\s*\\}'),
  cors_wildcard_count: countPattern(serverFiles, "Access-Control-Allow-Origin.*\\*"),
  extension_ts_lines: fs.readFileSync(path.join(ROOT, 'src/extension.ts'), 'utf8').split('\n').length,
};

console.log(JSON.stringify(metrics, null, 2));
process.exit(metrics.compile_ok && metrics.web_check_ok ? 0 : 1);
