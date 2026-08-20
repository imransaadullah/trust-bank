const nodemailer = require('nodemailer');
const { EmailProvider } = require('./emailProvider');
const logger = require('../utils/logger');

// A real, usable implementation the moment real SMTP credentials exist —
// works with any SMTP-compatible provider (AWS SES, SendGrid, Mailgun,
// Postmark, or a real Google Workspace account), not a stub waiting on a
// commercial relationship the way Cards/credit-bureau providers are.
//
// The email carries a raw token, not a clickable link — there's no
// staff-facing web page to land on yet (Phase 6's own UI item is still
// deferred). The recipient submits the token directly to
// POST /v1/password-reset/confirm.
class SmtpEmailProvider extends EmailProvider {
  constructor(config) {
    super('smtp');
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async sendPasswordResetEmail({ to, resetToken, expiresInMinutes }) {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'trust-bank password reset',
      text: [
        'A password reset was requested for your trust-bank staff account.',
        '',
        `Reset code (expires in ${expiresInMinutes} minutes):`,
        resetToken,
        '',
        'Submit this code to POST /v1/password-reset/confirm along with your new password.',
        "If you didn't request this, no action is needed — the code expires on its own.",
      ].join('\n'),
    });
    logger.info(`[SmtpEmailProvider] password reset email sent to ${to}`);
    return { sent: true };
  }
}

module.exports = { SmtpEmailProvider };
