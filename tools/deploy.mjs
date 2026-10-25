// Upload Roadster Thruster (a static site, no database) over FTPS to <FTP_REMOTE_ROOT>.
//
//   node tools/deploy.mjs --dry-run    list what would upload, change nothing
//   node tools/deploy.mjs              upload
//
// Mirrors upward only: never deletes anything remote. Builds an explicit file list so
// reference photos, videos, backups and .env.deploy never reach the web server.
// The contents of .env.deploy never reach stdout, stderr or an error message.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'basic-ftp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

/** The only things that belong on the web server. */
const INCLUDE = [{ file: 'index.html' }, { file: '.htaccess' }, { dir: 'css' }, { dir: 'js' }];

function loadEnv() {
  const p = path.join(ROOT, '.env.deploy');
  if (!fs.existsSync(p)) {
    const near = fs.readdirSync(ROOT).filter((f) => /env|deploy/i.test(f) && f !== '.env.deploy');
    throw new Error('.env.deploy not found at the project root.' + (near.length ? ` Similar name found: ${near.join(', ')} (rename it to exactly ".env.deploy").` : ''));
  }
  const env = {};
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  const missing = ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD', 'FTP_REMOTE_ROOT'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`.env.deploy is missing values for: ${missing.join(', ')}`); // names only
  return env;
}

/** Scrub secrets out of anything about to be printed. */
function safeError(err, env) {
  let msg = err && err.message ? String(err.message) : String(err);
  for (const k of ['FTP_PASSWORD', 'FTP_USER', 'FTP_HOST']) if (env[k] && env[k].length > 3) msg = msg.split(env[k]).join(`<${k}>`);
  return msg;
}

function walk(abs, rel, out) {
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(abs, e.name), r, out);
    else if (e.isFile() && !/^(\.env|thumbs\.db$|\.ds_store$)/i.test(e.name)) out.push(r);
  }
}

function collect() {
  const files = [];
  for (const it of INCLUDE) {
    const abs = path.join(ROOT, it.file || it.dir);
    if (!fs.existsSync(abs)) { console.warn(`  ! missing locally, skipped: ${it.file || it.dir}`); continue; }
    if (it.file) files.push(it.file); else walk(abs, it.dir, files);
  }
  return files.sort();
}

async function connect(env) {
  const base = { host: env.FTP_HOST, port: Number(env.FTP_PORT) || 21, user: env.FTP_USER, password: env.FTP_PASSWORD, secure: String(env.FTP_SECURE).toLowerCase() !== 'false' };
  const client = new Client(30000);
  try {
    await client.access({ ...base, secureOptions: { rejectUnauthorized: true } });
    console.log('  connected (certificate verified)');
    return client;
  } catch (err) {
    if (!base.secure || !/certificate|self[- ]signed|altnames|CERT_|hostname/i.test(safeError(err, env))) throw err;
    client.close();
    const retry = new Client(30000);
    await retry.access({ ...base, secureOptions: { rejectUnauthorized: false } });
    console.log('  connected over FTPS (certificate not verified, normal on shared hosting)');
    return retry;
  }
}

async function main() {
  let env;
  try { env = loadEnv(); } catch (e) { console.error(e.message); process.exitCode = 1; return; }
  const files = collect();
  const remoteRoot = env.FTP_REMOTE_ROOT.replace(/\/+$/, '');
  const kb = files.reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0) / 1024;
  console.log(`${DRY ? 'DEPLOY (dry run)' : 'DEPLOY'}: ${files.length} files, ${kb.toFixed(1)} KB\n`);
  if (DRY) { for (const f of files) console.log(`  would upload  ${f}`); return; }

  let client;
  try {
    client = await connect(env);
    const byDir = new Map();
    for (const f of files) { const d = path.posix.dirname(f); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(f); }
    for (const [dir, group] of [...byDir].sort()) {
      await client.ensureDir(dir === '.' ? remoteRoot : `${remoteRoot}/${dir}`);
      for (const f of group) { await client.uploadFrom(path.join(ROOT, f), path.basename(f)); console.log(`  uploaded  ${f}`); }
    }
    console.log(`\n  ${files.length} file(s) uploaded. Nothing remote was deleted.${env.APP_BASE ? `\n  Live at ${env.APP_BASE}/` : ''}`);
  } catch (err) {
    const m = safeError(err, env);
    console.error('\n  DEPLOY FAILED: ' + m);
    if (/530/.test(m)) console.error('  Login rejected: check FTP_USER / FTP_PASSWORD.');
    else if (/550/.test(m)) console.error('  Permission denied or no such directory: check FTP_REMOTE_ROOT.');
    process.exitCode = 1;
  } finally {
    if (client) client.close();
  }
}

main();
