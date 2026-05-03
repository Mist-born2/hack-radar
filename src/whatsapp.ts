import { Client, LocalAuth, Chat, GroupChat } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { config, log } from './config';
import { QualifiedOpportunity } from './types';
import { formatAlert, formatIntroMessage } from './format';
import { markAlerted } from './db';

let client: Client;
let targetChat: Chat | null = null;
let isReady = false;

type ReadyCallback = () => void;
let onReadyCallback: ReadyCallback | null = null;

export function onWhatsAppReady(cb: ReadyCallback): void {
  onReadyCallback = cb;
}

export async function initWhatsApp(): Promise<void> {
  if (config.dryRun) {
    log.info('DRY_RUN mode: WhatsApp client will not be initialized');
    isReady = true;
    if (onReadyCallback) onReadyCallback();
    return;
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.sessionPath }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    },
  });

  client.on('qr', (qr: string) => {
    log.info('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    log.info('WhatsApp authenticated');
  });

  client.on('auth_failure', (msg: string) => {
    log.error('WhatsApp auth failure:', msg);
  });

  client.on('ready', async () => {
    log.info('WhatsApp client ready');
    isReady = true;
    await resolveTargetGroup();
    if (onReadyCallback) onReadyCallback();
  });

  client.on('disconnected', (reason: string) => {
    log.warn('WhatsApp disconnected:', reason);
    isReady = false;
    targetChat = null;
  });

  await client.initialize();
}

async function resolveTargetGroup(): Promise<void> {
  if (!client) return;

  try {
    if (config.whatsapp.groupId) {
      log.info(`Resolving group by ID: ${config.whatsapp.groupId}`);
      const chat = await client.getChatById(config.whatsapp.groupId);
      if (chat && chat.isGroup) {
        targetChat = chat;
        log.info(`Target group resolved: ${(chat as GroupChat).name}`);
        return;
      }
      log.warn('Group ID did not resolve to a valid group');
    }

    if (config.whatsapp.groupName) {
      log.info(`Searching for group by name: "${config.whatsapp.groupName}"`);
      const chats = await client.getChats();
      const group = chats.find(
        c => c.isGroup && (c as GroupChat).name.toLowerCase().includes(config.whatsapp.groupName.toLowerCase())
      );
      if (group) {
        targetChat = group;
        log.info(`Target group found: ${(group as GroupChat).name} (${group.id._serialized})`);
        return;
      }
      log.warn(`No group found matching name "${config.whatsapp.groupName}"`);
    }

    log.error('No target group configured or found. Set WHATSAPP_GROUP_ID or WHATSAPP_GROUP_NAME.');
  } catch (e) {
    log.error('Failed to resolve target group:', e);
  }
}

export async function sendAlerts(opportunities: QualifiedOpportunity[]): Promise<number> {
  if (opportunities.length === 0) {
    log.info('No new opportunities to send');
    return 0;
  }

  const max = config.scan.maxAlertsPerScan;
  const toSend = opportunities.slice(0, max);
  if (opportunities.length > max) {
    log.info(`Capping alerts: ${opportunities.length} found, sending top ${max}`);
  }

  const highPriority = toSend.filter(o => o.priority === 'HIGH');
  const rest = toSend.filter(o => o.priority !== 'HIGH');

  let sent = 0;

  for (const opp of highPriority) {
    const success = await sendMessage(formatAlert(opp));
    if (success) {
      recordAlert(opp);
      sent++;
    }
    await sleep(1500);
  }

  if (rest.length > 0 || (highPriority.length > 0 && rest.length > 0)) {
    const totalNew = highPriority.length + rest.length;
    if (totalNew >= 3) {
      await sendMessage(formatIntroMessage(totalNew));
      await sleep(1000);
    }
  } else if (highPriority.length === 0 && toSend.length >= 3) {
    await sendMessage(formatIntroMessage(toSend.length));
    await sleep(1000);
  }

  for (const opp of rest) {
    const success = await sendMessage(formatAlert(opp));
    if (success) {
      recordAlert(opp);
      sent++;
    }
    await sleep(1500);
  }

  log.info(`Sent ${sent}/${toSend.length} alerts`);
  return sent;
}

async function sendMessage(text: string): Promise<boolean> {
  if (config.dryRun) {
    log.info('[DRY_RUN] Would send:\n' + text);
    return true;
  }

  if (!isReady || !targetChat) {
    log.error('WhatsApp not ready or no target group. Message not sent.');
    log.info('Unsent message:\n' + text);
    return false;
  }

  try {
    await targetChat.sendMessage(text);
    return true;
  } catch (e) {
    log.error('Failed to send WhatsApp message:', e);
    log.info('Unsent message:\n' + text);
    return false;
  }
}

function recordAlert(opp: QualifiedOpportunity): void {
  try {
    markAlerted({
      normalizedUrl: opp.normalizedUrl,
      normalizedTitle: opp.normalizedTitle,
      title: opp.title,
      url: opp.url,
      source: opp.source,
      priority: opp.priority,
      alertedAt: new Date().toISOString(),
    });
  } catch (e) {
    log.error('Failed to record alert in DB:', e);
  }
}

export async function destroyWhatsApp(): Promise<void> {
  if (client) {
    try {
      await client.destroy();
      log.info('WhatsApp client destroyed');
    } catch (e) {
      log.warn('Error destroying WhatsApp client:', e);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
