// Loads .env.deploy and connects over FTPS. Shared by deploy.mjs and push-config.mjs.
// The contents of .env.deploy never reach stdout, stderr or an error message.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'basic-ftp';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
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
export function safeError(err, env) {
  let msg = err && err.message ? String(err.message) : String(err);
  for (const k of ['FTP_PASSWORD', 'FTP_USER', 'FTP_HOST', 'DB_PASSWORD', 'DB_USER', 'DB_NAME']) if (env[k] && env[k].length > 3) msg = msg.split(env[k]).join(`<${k}>`);
  return msg;
}

export async function connect(env) {
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
