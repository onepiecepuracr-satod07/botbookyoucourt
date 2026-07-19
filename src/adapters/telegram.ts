import type { Notifier } from '../core/ports.js';
import { log } from './logger.js';

export function createTelegramNotifier(enabled: boolean): Notifier {
  return {
    async notify(message: string): Promise<void> {
      if (!enabled) return;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) {
        log.warn('telegram enabled but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
        return;
      }
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        });
        if (!response.ok) {
          log.error('telegram send failed', { status: response.status, body: await response.text() });
        }
      } catch (error) {
        log.error('telegram send threw', { error: String(error) });
      }
    },
  };
}
