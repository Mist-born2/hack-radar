import cron from 'node-cron';
import { config, log } from './config';
import { initDb, closeDb, getAlertedCount } from './db';
import { createScanners, runScan } from './scanner';
import { initWhatsApp, onWhatsAppReady, sendAlerts, destroyWhatsApp } from './whatsapp';

let isScanning = false;
let shutdownRequested = false;

async function performScan(): Promise<void> {
  if (isScanning) {
    log.warn('Scan already in progress, skipping');
    return;
  }

  isScanning = true;
  const start = Date.now();
  log.info('=== Scan cycle started ===');

  try {
    const scanners = createScanners();
    const opportunities = await runScan(scanners);

    if (opportunities.length > 0) {
      const sent = await sendAlerts(opportunities);
      log.info(`Scan complete: ${opportunities.length} new, ${sent} sent`);
    } else {
      log.info('Scan complete: no new qualifying opportunities');
    }
  } catch (e) {
    log.error('Scan cycle error:', e);
  } finally {
    isScanning = false;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.info(`=== Scan cycle finished in ${elapsed}s ===`);
  }
}

function setupSchedule(): void {
  const cronExpr = config.scan.cron;
  if (!cron.validate(cronExpr)) {
    log.error(`Invalid cron expression: ${cronExpr}`);
    process.exit(1);
  }

  cron.schedule(cronExpr, () => {
    if (!shutdownRequested) {
      performScan().catch(e => log.error('Scheduled scan error:', e));
    }
  });

  log.info(`Scan scheduled: ${cronExpr}`);
}

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info(`${signal} received, shutting down gracefully...`);

    if (isScanning) {
      log.info('Waiting for current scan to finish...');
      const maxWait = 60_000;
      const start = Date.now();
      while (isScanning && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await destroyWhatsApp();
    closeDb();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (e) => {
    log.error('Uncaught exception:', e);
  });
  process.on('unhandledRejection', (e) => {
    log.error('Unhandled rejection:', e);
  });
}

async function main(): Promise<void> {
  log.info('🚀 HackathonRadar starting...');
  log.info(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  log.info(`Data dir: ${config.dataDir}`);
  log.info(`Scan schedule: ${config.scan.cron}`);
  log.info(`Scan on start: ${config.scan.onStart}`);
  log.info(`Max alerts per scan: ${config.scan.maxAlertsPerScan}`);

  setupGracefulShutdown();
  initDb();

  const alertedCount = getAlertedCount();
  log.info(`Previously alerted: ${alertedCount} opportunities`);

  onWhatsAppReady(() => {
    log.info('WhatsApp ready, setting up schedule');
    setupSchedule();

    if (config.scan.onStart) {
      log.info('Running initial scan...');
      performScan().catch(e => log.error('Initial scan error:', e));
    }
  });

  await initWhatsApp();
}

main().catch(e => {
  log.error('Fatal error:', e);
  process.exit(1);
});
