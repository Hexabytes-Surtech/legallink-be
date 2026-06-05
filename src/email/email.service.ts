import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// Escape values that originate from user/advocate input before embedding them in
// HTML emails — otherwise an advocate name / decline reason like
// `<a href="https://evil">click</a>` becomes live markup in a LegalLink-branded mail.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;
  private fromEmail: string;

  constructor(private config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.fromEmail = this.config.get<string>('RESEND_FROM_EMAIL') as string;
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    const safeOtp = esc(otp);
    const digits = safeOtp
      .split('')
      .map(
        (d) =>
          `<td style="padding:0 5px;"><div style="width:46px;height:58px;line-height:58px;text-align:center;font-family:'Courier New',monospace;font-size:30px;font-weight:700;color:#0a3a5c;background:#eef6fc;border:1px solid #cfe6f7;border-radius:12px;">${d}</div></td>`,
      )
      .join('');

    const body = `
      <p style="margin:0 0 8px;font-size:16px;color:#16182b;font-weight:600;">Verify your sign-in</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#5b6072;">
        Use the one-time code below to continue signing in to your LegalLink account. This code is valid for the next <strong style="color:#16182b;">10 minutes</strong>.
      </p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr>${digits}</tr></table>
      <p style="margin:0 0 4px;font-size:13px;line-height:20px;color:#8a8f9e;text-align:center;">
        Didn't try to sign in? You can safely ignore this email — your account stays secure.
      </p>`;

    await this.send(
      to,
      'Your LegalLink verification code',
      this.renderShell('Verification code', body, `Your LegalLink verification code is ${safeOtp}`),
    );
  }

  /**
   * Branded, email-client-safe HTML shell (table layout + inline styles) shared
   * by all LegalLink transactional emails. `preheader` is the hidden inbox preview.
   */
  private renderShell(heading: string, bodyHtml: string, preheader = ''): string {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#eef1f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(10,58,92,0.10);">
        <!-- header -->
        <tr><td style="background:#0a78c0;background-image:linear-gradient(120deg,#0a78c0,#1aa3e8);padding:26px 32px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:.3px;">Legal<span style="color:#bfe6fb;">Link</span></span>
          <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#d6efff;">Free Legal Aid · West Bengal</div>
        </td></tr>
        <!-- body -->
        <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;">
          <h1 style="margin:0 0 18px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#0a78c0;font-weight:700;">${heading}</h1>
          ${bodyHtml}
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:20px 32px;background:#f6f8fb;border-top:1px solid #e6eaf1;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0;font-size:12px;line-height:18px;color:#9aa0ae;">
            This is an automated message from LegalLink. Please do not reply.<br>
            © LegalLink — AI-powered, anonymous, bilingual legal guidance.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  async sendAdvocateVerified(to: string, advocateName: string): Promise<void> {
    await this.send(
      to,
      'LegalLink — Your account has been verified',
      `<p>Hi ${esc(advocateName)},</p><p>Congratulations! Your advocate profile on LegalLink has been <strong>verified</strong>. You can now accept consultation requests from citizens.</p>`,
    );
  }

  async sendAdvocateRejected(to: string, advocateName: string, reason?: string): Promise<void> {
    const reasonLine = reason ? `<p><strong>Reason:</strong> ${esc(reason)}</p>` : '';
    await this.send(
      to,
      'LegalLink — Verification update',
      `<p>Hi ${esc(advocateName)},</p><p>Your verification request on LegalLink was <strong>not approved</strong> at this time.</p>${reasonLine}<p>Please update your profile and re-submit when ready.</p>`,
    );
  }

  async sendConsultationAccepted(to: string, advocateName: string, matterSummary: string): Promise<void> {
    await this.send(
      to,
      'LegalLink — Your consultation has been accepted',
      `<p>Your consultation request has been <strong>accepted</strong> by <strong>${esc(advocateName)}</strong>.</p><p><em>${esc(matterSummary)}</em></p><p>Log in to LegalLink to start chatting.</p>`,
    );
  }

  async sendConsultationDeclined(to: string, advocateName: string, reason?: string): Promise<void> {
    const reasonLine = reason ? `<p><strong>Reason:</strong> ${esc(reason)}</p>` : '';
    await this.send(
      to,
      'LegalLink — Consultation update',
      `<p>Your consultation request was <strong>declined</strong> by <strong>${esc(advocateName)}</strong>.</p>${reasonLine}<p>You can request a consultation with another advocate on LegalLink.</p>`,
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const response = await this.resend.emails.send({ from: this.fromEmail, to, subject, html });
      if (response.error) {
        this.logger.warn(`Email send failed to ${to}: ${response.error.message}`);
      }
    } catch (err) {
      this.logger.error(`Email send threw for ${to}: ${(err as Error).message}`);
    }
  }
}
