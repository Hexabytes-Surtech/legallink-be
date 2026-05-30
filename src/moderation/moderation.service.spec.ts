import { ModerationService } from './moderation.service';

describe('ModerationService (Rule 36 BCI safeguard)', () => {
  const svc = new ModerationService();

  describe('legitimate messages pass', () => {
    it.each([
      'Please send the rental agreement and the eviction notice you received.',
      'Based on the documents, we should file a written reply before the next hearing.',
      'Can you describe what happened on the day of the incident?',
      'I have reviewed your matter. Let us continue the discussion here on the platform.',
    ])('clears: %s', (msg) => {
      const r = svc.check(msg);
      expect(r.status).toBe('cleared');
      expect(r.flags).toEqual([]);
    });
  });

  describe('contact solicitation is flagged', () => {
    it.each([
      ['Indian mobile number', 'Call me at 9876543210 to discuss further'],
      ['verb + me + at', 'Please reach me directly outside this app'],
      ['whatsapp', "Let's continue on WhatsApp instead"],
      ['email address', 'Email me at advocate.sharma@gmail.com'],
      ['my number is', 'my number is 9123456780'],
    ])('flags %s', (_label, msg) => {
      const r = svc.check(msg);
      expect(r.status).toBe('flagged');
      expect(r.flags).toContain('contact_solicitation');
    });
  });

  it('flags fee solicitation', () => {
    expect(svc.check('My fee is 5000 rupees per hearing').flags).toContain('fee_solicitation');
    expect(svc.check('I charge ₹2000 for the first consultation').flags).toContain('fee_solicitation');
  });

  it('flags off-platform payment', () => {
    expect(svc.check('Pay me via UPI: advocate@okhdfcbank').flags).toContain('off_platform_payment');
    expect(svc.check('Do a bank transfer via NEFT to my account').flags).toContain('off_platform_payment');
  });

  it('flags outcome promises and comparison claims', () => {
    expect(svc.check('I guarantee we will win your case').flags).toContain('outcome_promise');
    expect(svc.check('I am the best lawyer in Kolkata').flags).toContain('comparison_claim');
  });

  it('flags Bengali fee / contact patterns', () => {
    expect(svc.check('আমার ফি ৫০০০ টাকা').flags).toContain('fee_solicitation');
    expect(svc.check('সরাসরি যোগাযোগ করুন').flags).toContain('contact_solicitation');
  });

  it('de-duplicates flags (two phone numbers → one flag)', () => {
    const r = svc.check('Call 9876543210 or 9123456780');
    expect(r.flags.filter((f) => f === 'contact_solicitation')).toHaveLength(1);
  });

  it('does NOT flag the platform domain email', () => {
    const r = svc.check('You can reach support at help@legallink.in');
    expect(r.flags).not.toContain('contact_solicitation');
  });
});
