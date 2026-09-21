import { getServerState } from '../repositories/stateRepository';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Sends a real-time notification alert via the Telegram Bot API.
 *
 * Credentials are resolved in priority order: environment variables first
 * (for cloud deploys) and then the bot config persisted by the dashboard.
 * Returns `true` only when Telegram acknowledged the message.
 */
export async function sendTelegramAlert(messageText: string): Promise<boolean> {
  try {
    const config = getServerState().botConfig?.telegramConfig;
    const token = process.env.TELEGRAM_BOT_TOKEN || config?.botToken;
    const chatId = process.env.TELEGRAM_CHAT_ID || config?.chatId;
    const isEnabled = config?.isEnabled !== undefined ? config.isEnabled : true;

    if (!token || !chatId || !isEnabled) return false;

    const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch (err) {
    console.warn('Telegram alert notification failed:', err);
    return false;
  }
}

/**
 * Low-level "send with explicit credentials" call used by the settings screen
 * to validate a token/chat-id pair before saving it.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  messageText: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    return { ok: false, error: data.description || 'เกิดข้อผิดพลาดจาก Telegram API' };
  }
  return { ok: true };
}
