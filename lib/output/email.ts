/**
 * Email delivery via Resend — sends the full HTML report as an attachment.
 *
 * The email body contains a brief summary, and the complete interactive
 * HTML report (with tabs, background image, etc.) is attached as a file.
 * Opening the attachment in a browser gives the full local experience.
 *
 * Configuration (in .env.local):
 *   RESEND_API_KEY   — required, from https://resend.com
 *   EMAIL_TO         — recipient address
 *   EMAIL_FROM       — sender address (defaults to onboarding@resend.dev)
 */

import { Resend } from "resend";

let _client: Resend | undefined;

function getClient(): Resend {
  if (!_client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is required for email delivery. Set it in .env.local.",
      );
    }
    _client = new Resend(apiKey);
  }
  return _client;
}

export interface SendReportEmailOptions {
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** Brief plain-text summary for the email body */
  bodyText: string;
  /** Full HTML content to attach */
  htmlContent: string;
  /** Attachment filename (e.g. "2026-06-14.html") */
  filename: string;
  /** Date string for logging */
  date: string;
}

/**
 * Send the daily report email with full HTML as an attachment.
 * Non-fatal: logs a warning on failure, does not throw.
 */
export async function sendReportEmail(
  opts: SendReportEmailOptions,
): Promise<boolean> {
  const from =
    process.env.EMAIL_FROM || "DailyBrief <onboarding@resend.dev>";

  // Encode HTML as base64 attachment
  const attachment = Buffer.from(opts.htmlContent, "utf-8").toString("base64");

  try {
    const resend = getClient();
    const { error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.bodyText,
      attachments: [
        {
          filename: opts.filename,
          content: attachment,
        },
      ],
    });

    if (error) {
      console.warn(`[email] send failed: ${error.message}`);
      return false;
    }

    console.log(`[email] sent to ${opts.to} (${opts.date})`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] send failed: ${msg}`);
    return false;
  }
}
