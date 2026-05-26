import { Injectable } from '@nestjs/common';

// Rule 36 BCI — advocates must not solicit clients or make outcome promises.
// This list is enforced on every message before it is persisted and broadcast.
const RULE36_PATTERNS: { pattern: RegExp; flag: string }[] = [
  { pattern: /\bguarantee\b.*\b(success|win|victory|result)\b/i, flag: 'outcome_promise' },
  { pattern: /\bi.ll\s+win\s+your\s+case\b/i, flag: 'outcome_promise' },
  { pattern: /\b(best|top|no[\s-]?1|number\s+one)\s+(lawyer|advocate|attorney)\b/i, flag: 'comparison_claim' },
  { pattern: /\bcontact\s+me\s+(directly|personally|outside)\b/i, flag: 'contact_solicitation' },
  { pattern: /\bwhatsapp\b|\btelegram\b|\bmy\s+number\s+is\b|\bcall\s+me\s+on\b/i, flag: 'contact_solicitation' },
  { pattern: /\bpay\s+(me|us|directly|cash|advance)\b/i, flag: 'fee_solicitation' },
  { pattern: /\bno\s+win\s+no\s+fee\b|\bcontingency\s+fee\b/i, flag: 'fee_solicitation' },
  { pattern: /\byour\s+chances\s+(are|look)\s+(great|excellent|very\s+good)\b/i, flag: 'outcome_promise' },
  // Bengali patterns
  { pattern: /সাফল্য\s*গ্যারান্টি|জয়\s*গ্যারান্টি/i, flag: 'outcome_promise' },
  { pattern: /সরাসরি\s*যোগাযোগ|হোয়াটসঅ্যাপ|ফোন\s*করুন/i, flag: 'contact_solicitation' },
];

export interface ModerationResult {
  status: 'cleared' | 'flagged';
  flags: string[];
}

@Injectable()
export class ModerationService {
  check(content: string): ModerationResult {
    const flags: string[] = [];

    for (const { pattern, flag } of RULE36_PATTERNS) {
      if (pattern.test(content) && !flags.includes(flag)) {
        flags.push(flag);
      }
    }

    return {
      status: flags.length > 0 ? 'flagged' : 'cleared',
      flags,
    };
  }
}
