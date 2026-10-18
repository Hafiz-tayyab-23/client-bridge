import "server-only";

/** Telegram Bot API adapter (I4). Classifies errors as temporary (retry) or permanent. */
export interface SendResult { ok: boolean; permanent?: boolean; error?: string; reference?: string }

export async function sendTelegram(botToken: string, chatId: string, text: string): Promise<SendResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (res.ok && body.ok) return { ok: true, reference: String(body.result?.message_id ?? "") };
    const permanent = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404;
    const hint =
      res.status === 401 || res.status === 404 ? "The bot token is invalid. Update it on the Integrations page."
      : res.status === 403 ? "The user has not started the bot or has blocked it. Ask them to send /start to the bot."
      : res.status === 400 ? "The chat ID is wrong. The employee should re-check their Telegram chat ID."
      : "Telegram is temporarily unavailable; will retry.";
    return { ok: false, permanent, error: `${res.status} ${body.description ?? ""} — ${hint}`.trim() };
  } catch (e) {
    return { ok: false, permanent: false, error: `Network error contacting Telegram (${(e as Error).message}); will retry.` };
  }
}

export async function getMe(botToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string };
    return body.ok ? { ok: true, username: body.result?.username } : { ok: false, error: body.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
