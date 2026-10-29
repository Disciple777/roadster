// Upload Roadster Thruster (the game plus its small PHP leaderboard API) over FTPS to <FTP_REMOTE_ROOT>.
//
//   node tools/deploy.mjs --dry-run    list what would upload, change nothing
//   node tools/deploy.mjs              upload
//   node tools/deploy.mjs --only=api   upload just one folder or file
//
// Mirrors upward only: never deletes anything remote. Builds an explicit file list so
// reference photos, videos, backups and .env.deploy never reach the web server.
// The contents of .env.deploy never reach stdout, stderr or an error message.
// api/config.php (database credentials) lives only on the server: tools/push-config.mjs writes it,
// this script never uploads anything config-shaped and refuses to run if a local copy exists.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEnv, safeError, connect } from './env.mjs';

const DRY = process.argv.includes('--dry-run');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

/** The only things that belong on the web server. */
const INCLUDE = [{ file: 'index.html' }, { file: '.htaccess' }, { dir: 'css' }, { dir: 'js' }, { dir: 'api' }];

function walk(abs, rel, out) {
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(abs, e.name), r, out);
    else if (e.isFile() && !/^(\.env|thumbs\.db$|\.ds_store$|config(?!\.example))/i.test(e.name)) out.push(r);
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

async function main() {
  let env;
  try { env = loadEnv(); } catch (e) { console.error(e.message); process.exitCode = 1; return; }
  const local = fs.existsSync(path.join(ROOT, 'api')) ? fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /^config/i.test(f)) : [];
  if (local.length) {
    console.error(`REFUSING TO DEPLOY: config-shaped file(s) in api/: ${local.join(', ')}.`);
    console.error('  The live database config exists only on the server (tools/push-config.mjs). Delete the local copy.');
    process.exitCode = 1; return;
  }
  const files = collect().filter((f) => !ONLY || f === ONLY || f.startsWith(ONLY + '/'));
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
