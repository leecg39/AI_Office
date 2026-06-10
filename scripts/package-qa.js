#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = readJson(path.join(ROOT, 'package.json'));
const checks = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rel(...parts) {
  return path.join(ROOT, ...parts);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exists(relativePath) {
  return fs.existsSync(rel(relativePath));
}

function norm(value) {
  return String(value || '').normalize('NFC');
}

function findNormalized(dir, wanted) {
  const target = norm(wanted);
  return fs.readdirSync(dir).find((name) => norm(name) === target) || '';
}

function check(name, run) {
  try {
    run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message || String(error) });
  }
}

function failIfNeeded() {
  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length) process.exit(1);
}

function localReadmeAssets() {
  const readme = fs.readFileSync(rel('README.md'), 'utf8');
  const assets = new Set();
  for (const match of readme.matchAll(/(?:src=|!\[[^\]]*\]\()["']?([^"')\s]+)["']?/g)) {
    const asset = match[1];
    if (!asset || /^(https?:|data:|#)/i.test(asset)) continue;
    assets.add(asset);
  }
  return Array.from(assets);
}

function agentProfileImages() {
  const source = fs.readFileSync(rel('src', 'agents.ts'), 'utf8');
  return Array.from(new Set(Array.from(source.matchAll(/profileImage:\s*['"]([^'"]+)['"]/g)).map((match) => match[1])));
}

function vsixPath() {
  return process.env.CONNECT_AI_VSIX
    ? path.resolve(process.env.CONNECT_AI_VSIX)
    : rel(`connect-ai-lab-${pkg.version}.vsix`);
}

function zipEntries(file) {
  const raw = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' });
  return raw.split(/\r?\n/).filter(Boolean);
}

function hasEntry(entries, wanted) {
  const target = norm(wanted);
  return entries.some((entry) => norm(entry) === target);
}

function hasPrefix(entries, wantedPrefix) {
  const target = norm(wantedPrefix);
  return entries.some((entry) => norm(entry).startsWith(target));
}

function zipEntryText(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function looksTextEntry(entry) {
  if (entry.startsWith('[')) return false;
  return /\.(?:css|html|js|json|md|txt|xml)$/i.test(entry);
}

function gitLines(args) {
  try {
    const raw = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return raw.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function gitOk(args) {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isGitWorktree() {
  return gitLines(['rev-parse', '--is-inside-work-tree'])[0] === 'true';
}

function listFiles(dir) {
  const root = rel(dir);
  if (!fs.existsSync(root)) return [];
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(root);
  return files;
}

function packageInputFiles() {
  const agentFiles = agentProfileImages()
    .map((image) => findNormalized(rel('assets', 'agents'), image))
    .filter(Boolean)
    .map((image) => rel('assets', 'agents', image));
  const readmeAssets = localReadmeAssets().map((asset) => rel(asset));
  return Array.from(new Set([
    rel('package.json'),
    rel('README.md'),
    rel('.vscodeignore'),
    rel('out', 'extension.js'),
    rel('assets', 'extension-icon.png'),
    rel('assets', 'office.png'),
    rel('assets', 'petasos-logo.png'),
    rel('assets', 'force-graph.min.js'),
    rel('web', 'app.js'),
    rel('web', 'completed.html'),
    rel('web', 'completed.js'),
    rel('web', 'index.html'),
    rel('web', 'styles.css'),
    ...listFiles('src'),
    ...listFiles(path.join('assets', 'webview')),
    ...listFiles(path.join('assets', 'brain-seeds', 'anntar')),
    ...listFiles(path.join('assets', 'brain-seeds', 'templates')),
    ...listFiles(path.join('assets', 'prompts')),
    ...listFiles(path.join('assets', 'tool-seeds')),
    ...agentFiles,
    ...readmeAssets
  ]));
}

check('manifest icon asset exists', () => {
  assert(pkg.icon === 'assets/extension-icon.png', `package icon should be assets/extension-icon.png, got ${pkg.icon}`);
  assert(exists(pkg.icon), `missing package icon: ${pkg.icon}`);
});

check('version metadata is aligned', () => {
  const readme = fs.readFileSync(rel('README.md'), 'utf8');
  const extension = fs.readFileSync(rel('src', 'extension.ts'), 'utf8');
  const versionConstant = extension.match(/const\s+_CONNECT_AI_VERSION\s*=\s*['"]([^'"]+)['"]/);
  assert(versionConstant && versionConstant[1] === pkg.version, `_CONNECT_AI_VERSION is not ${pkg.version}`);
  assert(readme.includes(`Connect AI v${pkg.version}`), `README title copy does not mention v${pkg.version}`);
  assert(readme.includes(`version-${pkg.version}-blue`), `README version badge does not match ${pkg.version}`);
  assert(readme.includes(`connect-ai-lab-${pkg.version}.vsix`), `README VSIX filename does not match ${pkg.version}`);
});

check('README local image assets exist', () => {
  for (const asset of localReadmeAssets()) {
    assert(exists(asset), `README references missing asset: ${asset}`);
  }
});

check('runtime assets exist on disk', () => {
  [
    'assets/office.png',
    'assets/petasos-logo.png',
    'assets/force-graph.min.js',
    'assets/webview/sidebar.html',
    'assets/webview/api-panel.js',
    'assets/webview/api-panel.css',
    'assets/brain-seeds/anntar/operating-contract.md',
    'assets/brain-seeds/templates/developer/landing-kit/manifest.json'
  ].forEach((asset) => assert(exists(asset), `missing runtime asset: ${asset}`));
});

check('anntar operating migration is wired', () => {
  const extension = fs.readFileSync(rel('src', 'extension.ts'), 'utf8');
  const webServer = fs.readFileSync(rel('scripts', 'web-server.js'), 'utf8');
  const planner = fs.readFileSync(rel('assets', 'prompts', 'ceo-planner.md'), 'utf8');
  const system = fs.readFileSync(rel('assets', 'prompts', 'system.md'), 'utf8');
  [
    'operating-contract.md',
    'agent-heartbeat.md',
    'business-due-diligence-checklist.md',
    'technical-due-diligence-checklist.md',
    'research-source-format.md',
    'role-permission-routing.md',
    'product-marketing-context.md',
    'marketing-osmu-workflow.md',
    'issue-run-governance.md',
    'hermes-bootstrap-playbook.md'
  ].forEach((name) => assert(exists(path.join('assets', 'brain-seeds', 'anntar', name)), `missing Anntar seed: ${name}`));
  assert(extension.includes('_seedAnntarOperatingSeedsIfMissing'), 'Extension does not seed Anntar operating docs');
  assert(webServer.includes('seedBundledAnntarBrainSeeds'), 'Standalone web server does not seed Anntar operating docs');
  assert(planner.includes('증거 기반 운영 원칙'), 'CEO planner does not include evidence operating policy');
  assert(planner.includes('OSMU 흐름'), 'CEO planner does not include OSMU routing policy');
  assert(system.includes('접근 가능한 원본 URL'), 'System prompt does not include URL normalization policy');
  assert(system.includes('중간 진행률에서 방치하지 않습니다'), 'System prompt does not include issue-run completion policy');
});

check('agent profile images exist on disk', () => {
  const agentsDir = rel('assets', 'agents');
  for (const image of agentProfileImages()) {
    assert(findNormalized(agentsDir, image), `missing agent profile image: assets/agents/${image}`);
  }
});

check('extension fallback code covers removed pixel assets', () => {
  const source = fs.readFileSync(rel('src', 'extension.ts'), 'utf8');
  assert(source.includes("source: 'profile'"), 'Office character resolver does not use assets/agents profile fallback');
  assert(source.includes("path.join(extAssets, 'office.png')"), 'Office map resolver does not include assets/office.png');
  assert(source.includes("'templates'"), 'Bundled template seed path is not ASCII-safe');
  assert(source.includes("portrait = view.webview.asWebviewUri(customPath).toString()"), 'Sidebar portrait fallback still looks stale');
});

check('local QA scripts exist and are wired', () => {
  const readme = fs.readFileSync(rel('README.md'), 'utf8');
  const agents = fs.readFileSync(rel('AGENTS.md'), 'utf8');
  [
    'scripts/package-qa.js',
    'scripts/research-security-qa.js',
    'scripts/web-ui-qa.js',
    'scripts/web-e2e.js',
    'scripts/qa-all.js'
  ].forEach((script) => assert(exists(script), `missing local QA script: ${script}`));
  assert(String(pkg.scripts['package:qa'] || '').includes('scripts/package-qa.js'), 'package:qa is not wired to scripts/package-qa.js');
  assert(String(pkg.scripts['web:check'] || '').includes('scripts/research-security-qa.js'), 'web:check does not run research-security-qa.js');
  assert(String(pkg.scripts['web:check'] || '').includes('scripts/web-ui-qa.js'), 'web:check does not run web-ui-qa.js');
  assert(String(pkg.scripts['web:check'] || '').includes('scripts/qa-all.js'), 'web:check does not syntax-check scripts/qa-all.js');
  assert(String(pkg.scripts['web:e2e'] || '').includes('scripts/web-e2e.js'), 'web:e2e is not wired to scripts/web-e2e.js');
  const qaAll = String(pkg.scripts['qa:all'] || '');
  assert(qaAll.includes('scripts/qa-all.js'), 'qa:all is not wired to scripts/qa-all.js');
  const qaAllSource = fs.readFileSync(rel('scripts', 'qa-all.js'), 'utf8');
  ['web:check', 'test', 'web:e2e', 'package:vsix', 'package:qa']
    .forEach((script) => assert(qaAllSource.includes(script), `qa-all runner does not run ${script}`));
  assert(qaAllSource.includes('CONNECT_AI_QA_BASE_URL'), 'qa-all runner does not pass CONNECT_AI_QA_BASE_URL');
  assert(qaAllSource.includes('CONNECT_AI_WEB_PORT'), 'qa-all runner does not start an isolated web port');
  assert(readme.includes('npm run qa:all'), 'README does not document npm run qa:all');
  assert(agents.includes('npm run qa:all'), 'AGENTS.md does not document npm run qa:all');
});

check('git excludes local secrets and generated artifacts', () => {
  if (!isGitWorktree()) return;
  const protectedPaths = [
    'web/config.local.json',
    'web/data/llm-credentials.local.json',
    'web/data/state.json',
    'out/extension.js',
    `connect-ai-lab-${pkg.version}.vsix`
  ];
  const tracked = new Set(gitLines(['ls-files']));
  for (const file of protectedPaths) {
    assert(!tracked.has(file), `local/generated file is tracked by git: ${file}`);
    if (fs.existsSync(rel(file))) {
      assert(gitOk(['check-ignore', '-q', file]), `local/generated file is not ignored by git: ${file}`);
    }
  }
});

check('vsix exists', () => {
  assert(fs.existsSync(vsixPath()), `missing VSIX: ${vsixPath()}`);
});

check('vsix is newer than package inputs', () => {
  const vsixStat = fs.statSync(vsixPath());
  const staleInputs = packageInputFiles()
    .filter((file) => fs.existsSync(file) && fs.statSync(file).mtimeMs > vsixStat.mtimeMs + 1000)
    .map((file) => path.relative(ROOT, file));
  assert(staleInputs.length === 0, `VSIX is older than package inputs: ${staleInputs.join(', ')}`);
});

check('vsix includes required runtime assets', () => {
  const entries = zipEntries(vsixPath());
  [
    'extension/package.json',
    'extension/out/extension.js',
    'extension/assets/extension-icon.png',
    'extension/assets/office.png',
    'extension/assets/petasos-logo.png',
    'extension/assets/force-graph.min.js',
    'extension/assets/webview/sidebar.html',
    'extension/assets/brain-seeds/anntar/operating-contract.md',
    'extension/assets/brain-seeds/templates/developer/landing-kit/manifest.json'
  ].forEach((entry) => assert(hasEntry(entries, entry), `VSIX missing ${entry}`));

  const agentsDir = rel('assets', 'agents');
  for (const image of agentProfileImages()) {
    const actual = findNormalized(agentsDir, image);
    assert(actual, `missing agent profile image before VSIX check: ${image}`);
    assert(hasEntry(entries, `extension/assets/agents/${actual}`), `VSIX missing extension/assets/agents/${actual}`);
  }
});

check('vsix excludes local secrets and stale assets', () => {
  const entries = zipEntries(vsixPath());
  [
    'extension/web/config.local.json',
    'extension/assets/icon.png',
    'extension/assets/map.jpeg'
  ].forEach((entry) => assert(!hasEntry(entries, entry), `VSIX should not include ${entry}`));
  assert(!hasPrefix(entries, 'extension/web/data/'), 'VSIX should not include extension/web/data/');
  assert(!entries.some((entry) => /llm-credentials|\.DS_Store/.test(entry)), 'VSIX contains local credential or .DS_Store files');
  assert(!entries.some((entry) => entry.includes('�')), 'VSIX contains mojibake path entries');
});

check('vsix text does not contain secret-like tokens', () => {
  const secretPatterns = [
    /xai-[A-Za-z0-9_-]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /AIza[0-9A-Za-z_-]{20,}/,
    /ghp_[0-9A-Za-z_]{20,}/,
    /Bearer\s+[A-Za-z0-9._-]{20,}/
  ];
  const entries = zipEntries(vsixPath()).filter(looksTextEntry);
  for (const entry of entries) {
    const text = zipEntryText(vsixPath(), entry);
    const matched = secretPatterns.find((pattern) => pattern.test(text));
    assert(!matched, `VSIX text entry contains a secret-like token: ${entry}`);
  }
});

check('vsix excludes development QA scripts', () => {
  const entries = zipEntries(vsixPath());
  assert(!hasPrefix(entries, 'extension/scripts/'), 'VSIX should not include development scripts/');
});

failIfNeeded();
