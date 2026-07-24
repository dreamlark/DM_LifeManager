/**
 * Modul: Setup-Script (CLI)
 * Zweck: Erstes Admin-Konto anlegen + SESSION_SECRET sicherstellen.
 *        Yuvomi-Parität: `node setup.js` nach dem ersten Start.
 */

import readline from 'node:readline';
import bcrypt from 'bcrypt';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDb } from './server/db.js';

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((r) => rl.question(q, r));
const promptPass = () => new Promise((resolve) => {
  process.stdout.write('Password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let pw = '';
  process.stdin.on('data', function handler(c) {
    c = c.toString();
    if (c === '\r' || c === '\n') {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handler);
      process.stdout.write('\n');
      resolve(pw);
    } else if (c === '\u0003') process.exit();
    else if (c === '\u007f') { if (pw.length) { pw = pw.slice(0, -1); process.stdout.write('\b \b'); } }
    else { pw += c; process.stdout.write('*'); }
  });
});

async function main() {
  console.log('\n=== DM Life Setup ===\n');

  const existing = getDb().prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (existing) {
    console.log('An admin account already exists.\n');
    rl.close();
    process.exit(0);
  }

  const username = (await prompt('Username: ')).trim();
  if (!username || username.length < 3) { console.error('Username must be at least 3 chars.'); process.exit(1); }
  const displayName = (await prompt('Display name: ')).trim();
  if (!displayName) { console.error('Display name required.'); process.exit(1); }
  const password = await promptPass();
  if (password.length < 8) { console.error('Password must be at least 8 chars.'); process.exit(1); }
  const confirm = await promptPass();
  if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }

  const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
  const hash = await bcrypt.hash(password, 12);
  getDb().prepare('INSERT INTO users (username, display_name, password_hash, avatar_color, role) VALUES (?,?,?,?,?)')
    .run(username, displayName, hash, colors[Math.floor(Math.random() * colors.length)], 'admin');

  const port = process.env.PORT || 3000;
  const host = getLocalIP();
  console.log('\nAdmin account created!\n');
  console.log(`  Local:   http://localhost:${port}`);
  if (host) console.log(`  Network: http://${host}:${port}`);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
