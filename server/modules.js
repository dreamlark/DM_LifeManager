/**
 * Modul: Module-Loader
 * Zweck: Scannt modules/*, führt Migrationen aus, mounted Routen + statische
 * Frontend-Assets. Yuvomi-Stil: Module sind Drop-in-Ordner (index.js + public/).
 *
 * Modul-Vertrag (modules/<name>/index.js):
 *   export default {
 *     name:   'daily-board',
 *     nav:    { label, icon, path, order },   // für die SPA-Navigation
 *     migrate(db) {},                           // CREATE TABLE IF NOT EXISTS
 *     routes(ctx) { return express.Router() }   // mounted unter /api/v1/<name>
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { getDb } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('Modules');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(__dirname, '..', 'modules');

const ctx = {
  db: getDb(),
  requireAuth,
  requireAdmin,
  apiPrefix: '/api/v1',
};

/**
 * Lädt alle Module und registriert sie an der Express-App.
 * @param {import('express').Express} app
 * @returns {{name:string, label:string, icon:string, path:string, order:number}[]}
 */
export async function loadModules(app) {
  if (!fs.existsSync(MODULES_DIR)) {
    log.warn(`Modules directory not found: ${MODULES_DIR}`);
    return [];
  }

  const entries = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const nav = [];

  for (const name of entries) {
    const modPath = path.join(MODULES_DIR, name, 'index.js');
    if (!fs.existsSync(modPath)) {
      log.warn(`Module "${name}" has no index.js — skipped.`);
      continue;
    }

    let mod;
    try {
      mod = (await import(pathToFileURL(modPath).href)).default;
    } catch (err) {
      log.error(`Failed to load module "${name}":`, err.message);
      continue;
    }

    const modName = mod.name || name;

    // 1) Migration
    if (typeof mod.migrate === 'function') {
      try { mod.migrate(ctx.db); } catch (err) {
        log.error(`Migration failed for "${modName}":`, err.message);
        continue;
      }
    }

    // 2) Routen
    if (typeof mod.routes === 'function') {
      const router = mod.routes(ctx);
      app.use(`/api/v1/${modName}`, router);
      log.info(`Module routes mounted: /api/v1/${modName}`);
    }

    // 3) Statische Frontend-Assets (page.js, styles)
    const publicDir = path.join(MODULES_DIR, name, 'public');
    if (fs.existsSync(publicDir)) {
      app.use(`/modules/${modName}`, express.static(publicDir, { redirect: false }));
    }

    // 4) Navigation
    if (mod.nav) {
      nav.push({ name: modName, ...mod.nav });
    }
  }

  nav.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return nav;
}

export default loadModules;
