import path from 'path';

function env(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

export const config = {
  whatsapp: {
    groupId: env('WHATSAPP_GROUP_ID', ''),
    groupName: env('WHATSAPP_GROUP_NAME', 'HackathonRadar'),
  },
  scan: {
    cron: env('SCAN_CRON', '0 */6 * * *'),
    onStart: envBool('SCAN_ON_START', true),
    maxAlertsPerScan: envInt('MAX_ALERTS_PER_SCAN', 10),
  },
  dryRun: envBool('DRY_RUN', false),
  dataDir: env('DATA_DIR', './data'),
  logLevel: env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  get dbPath(): string {
    return path.join(this.dataDir, 'hackradar.db');
  },
  get sessionPath(): string {
    return path.join(this.dataDir, 'wwebjs_auth');
  },
};

const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: string): boolean {
  return (levels[level] ?? 1) >= (levels[config.logLevel] ?? 1);
}

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  debug: (...args: unknown[]) => { if (shouldLog('debug')) console.log(`[${ts()}] [DEBUG]`, ...args); },
  info: (...args: unknown[]) => { if (shouldLog('info')) console.log(`[${ts()}] [INFO]`, ...args); },
  warn: (...args: unknown[]) => { if (shouldLog('warn')) console.warn(`[${ts()}] [WARN]`, ...args); },
  error: (...args: unknown[]) => { if (shouldLog('error')) console.error(`[${ts()}] [ERROR]`, ...args); },
};
