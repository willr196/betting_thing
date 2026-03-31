import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

// =============================================================================
// EMAIL SERVICE
// =============================================================================
// Thin wrapper around nodemailer. Falls back to logging the email content
// to the console when SMTP is not configured (useful in development).

function createTransport() {
  if (!config.email.host) {
    // No SMTP configured — return null so callers can log instead
    return null;
  }

  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth:
      config.email.user && config.email.pass
        ? { user: config.email.user, pass: config.email.pass }
        : undefined,
  });
}

export const EmailService = {
  async sendPasswordReset(
    toEmail: string,
    resetUrl: string
  ): Promise<void> {
    const subject = 'Reset your password';
    const html = `
      <p>Hi,</p>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
      </p>
      <p>This link expires in ${config.email.passwordResetExpiresMinutes} minutes. If you didn't request a password reset, you can safely ignore this email.</p>
      <p style="color:#6b7280;font-size:13px">If the button doesn't work, copy and paste this URL into your browser:<br>${resetUrl}</p>
    `;

    const transport = createTransport();

    if (!transport) {
      let resetOrigin: string | null = null;
      try {
        resetOrigin = new URL(resetUrl).origin;
      } catch {
        resetOrigin = null;
      }

      logger.info(
        {
          toEmail,
          resetOrigin,
          expiresInMinutes: config.email.passwordResetExpiresMinutes,
        },
        '[DEV] Password reset requested (SMTP not configured)'
      );
      return;
    }

    await transport.sendMail({
      from: config.email.from,
      to: toEmail,
      subject,
      html,
    });
  },
};
