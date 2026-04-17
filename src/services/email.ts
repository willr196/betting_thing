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

async function sendHtmlEmail(options: {
  toEmail: string;
  subject: string;
  html: string;
  devLogMessage: string;
  devLogData: Record<string, unknown>;
}): Promise<void> {
  const transport = createTransport();

  if (!transport) {
    logger.info(
      {
        toEmail: options.toEmail,
        ...options.devLogData,
      },
      options.devLogMessage
    );
    return;
  }

  await transport.sendMail({
    from: config.email.from,
    to: options.toEmail,
    subject: options.subject,
    html: options.html,
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

    let resetOrigin: string | null = null;
    try {
      resetOrigin = new URL(resetUrl).origin;
    } catch {
      resetOrigin = null;
    }

    await sendHtmlEmail({
      toEmail,
      subject,
      html,
      devLogMessage: '[DEV] Password reset requested (SMTP not configured)',
      devLogData: {
        resetOrigin,
        expiresInMinutes: config.email.passwordResetExpiresMinutes,
      },
    });
  },

  async sendEmailVerification(
    toEmail: string,
    verificationUrl: string
  ): Promise<void> {
    const subject = 'Confirm your email address';
    const html = `
      <p>Hi,</p>
      <p>Confirm your email address to finish setting up your account.</p>
      <p style="margin:24px 0">
        <a href="${verificationUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Confirm Email
        </a>
      </p>
      <p>This link expires in ${config.email.emailVerificationExpiresMinutes} minutes. If you did not create this account, you can safely ignore this email.</p>
      <p style="color:#6b7280;font-size:13px">If the button doesn't work, copy and paste this URL into your browser:<br>${verificationUrl}</p>
    `;

    let verificationOrigin: string | null = null;
    try {
      verificationOrigin = new URL(verificationUrl).origin;
    } catch {
      verificationOrigin = null;
    }

    await sendHtmlEmail({
      toEmail,
      subject,
      html,
      devLogMessage: '[DEV] Email verification requested (SMTP not configured)',
      devLogData: {
        verificationOrigin,
        expiresInMinutes: config.email.emailVerificationExpiresMinutes,
      },
    });
  },
};
