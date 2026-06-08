#!/usr/bin/env node
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;
const explicitBaseUrl = String(process.env.CONNECT_AI_QA_BASE_URL || '').replace(/\/+$/, '');

let serverProcess = null;
let serverLogs = '';

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
      }
    });
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

async function findOpenPort() {
  const preferred = Number(process.env.CONNECT_AI_QA_PORT || 18788);
  const candidates = [preferred, 18788, 18789, 18790, 18791, 18792].filter((port, index, ports) => (
    Number.isFinite(port) && port > 0 && ports.indexOf(port) === index
  ));
  for (const port of candidates) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free local QA port found: ${candidates.join(', ')}`);
}

function requestJson(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${pathname}`, { timeout: 3000 }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out waiting for ${baseUrl}${pathname}`)));
    req.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 15000) {
    try {
      const response = await requestJson(baseUrl, '/api/status');
      if (response.status === 200 && response.data && response.data.ok !== false) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  const suffix = serverLogs ? `\n\nServer output:\n${serverLogs.slice(-4000)}` : '';
  throw new Error(`QA web server did not become ready at ${baseUrl}: ${lastError ? lastError.message : 'unknown error'}${suffix}`);
}

async function startServerIfNeeded() {
  if (explicitBaseUrl) return explicitBaseUrl;
  const port = await findOpenPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(nodeCommand, [path.join(ROOT, 'scripts', 'web-server.js')], {
    cwd: ROOT,
    env: { ...process.env, CONNECT_AI_WEB_PORT: String(port), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) serverLogs += `\nQA web server exited with ${code}\n`;
  });
  await waitForServer(baseUrl);
  console.log(`[qa:all] started temporary web server at ${baseUrl}`);
  return baseUrl;
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill('SIGTERM');
}

async function main() {
  const baseUrl = await startServerIfNeeded();
  const qaEnv = { CONNECT_AI_QA_BASE_URL: baseUrl };
  try {
    await run(npmCommand, ['run', 'web:check'], qaEnv);
    await run(npmCommand, ['test'], qaEnv);
    await run(npmCommand, ['run', 'web:e2e'], qaEnv);
    await run(npmCommand, ['run', 'package:vsix'], qaEnv);
    await run(npmCommand, ['run', 'package:qa'], qaEnv);
  } finally {
    stopServer();
  }
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopServer();
  process.exit(143);
});

main().catch((error) => {
  stopServer();
  console.error(error.message || String(error));
  process.exit(1);
});
