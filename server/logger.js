/**
 * Modul: Logger
 * Zweck: Minimaler, farbcodierter Konsolen-Logger (kein externes Dep).
 * Yuvomi-Stil: Benannte Sub-Logger pro Komponente.
 */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function createLogger(name) {
  const tag = `${COLORS.cyan}[${name}]${COLORS.reset}`;
  const out = (level, color, args) => {
    const line = `${COLORS.gray}${ts()}${COLORS.reset} ${tag} ${color}${level}${COLORS.reset}`;
    // eslint-disable-next-line no-console
    console.log(line, ...args);
  };
  return {
    info: (...a) => out('INFO ', COLORS.green, a),
    warn: (...a) => out('WARN ', COLORS.yellow, a),
    error: (...a) => out('ERROR', COLORS.red, a),
    debug: (...a) => { if (process.env.LOG_LEVEL === 'debug') out('DEBUG', COLORS.gray, a); },
  };
}

export default createLogger;
