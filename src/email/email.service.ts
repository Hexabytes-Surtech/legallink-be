import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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
    await this.send(to, 'Your LegalLink OTP', `<p>Your OTP is <strong>${otp}</strong>. It expires in 10 minutes.</p>`);
  }

  async sendAdvocateVerified(to: string, advocateName: string): Promise<void> {
    await this.send(
      to,
      'LegalLink — Your account has been verified',
      `<p>Hi ${advocateName},</p><p>Congratulations! Your advocate profile on LegalLink has been <strong>verified</strong>. You can now accept consultation requests from citizens.</p>`,
    );
  }

  async sendAdvocateRejected(to: string, advocateName: string, reason?: string): Promise<void> {
    const reasonLine = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : '';
    await this.send(
      to,
      'LegalLink — Verification update',
      `<p>Hi ${advocateName},</p><p>Your verification request on LegalLink was <strong>not approved</strong> at this time.</p>${reasonLine}<p>Please update your profile and re-submit when ready.</p>`,
    );
  }

  async sendConsultationAccepted(to: string, advocateName: string, matterSummary: string): Promise<void> {
    await this.send(
      to,
      'LegalLink — Your consultation has been accepted',
      `<p>Your consultation request has been <strong>accepted</strong> by <strong>${advocateName}</strong>.</p><p><em>${matterSummary}</em></p><p>Log in to LegalLink to start chatting.</p>`,
    );
  }

  async sendConsultationDeclined(to: string, advocateName: string, reason?: string): Promise<void> {
    const reasonLine = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : '';
    await this.send(
      to,
      'LegalLink — Consultation update',
      `<p>Your consultation request was <strong>declined</strong> by <strong>${advocateName}</strong>.</p>${reasonLine}<p>You can request a consultation with another advocate on LegalLink.</p>`,
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
