/**
 * Minimal transactional email sender (Resend's HTTP API — no extra package needed).
 *
 * Needs two environment variables:
 *   RESEND_API_KEY  — an API key from resend.com
 *   EMAIL_FROM      — the sender, e.g.  Ledgerline <invites@yourdomain.com>
 *
 * When either is missing, sending is skipped rather than failing, so the app keeps
 * working and callers can fall back to showing a shareable link.
 * To use another provider (Postmark, SendGrid, SES), only this file needs to change.
 */

export type SendEmailResult = { sent: true } | { sent: false; skipped?: boolean; error?: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, skipped: true };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body?.message ?? body?.error ?? `The email service returned status ${res.status}.`;
      console.error("[email] send failed:", res.status, message);
      return { sent: false, error: String(message) };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] could not reach the email service:", err);
    return { sent: false, error: "Could not reach the email service." };
  }
}
