import { Injectable } from '@nestjs/common';

// Rule 36 BCI — advocates must not solicit clients, mention fees, promise outcomes,
// or move conversations off-platform. The list below enforces this on every message
// before it is persisted and broadcast.
//
// Pattern bank intentionally over-flags rather than under-flags. False positives are
// surfaced to the admin moderation queue (cheap to dismiss); a missed violation is
// a compliance breach (expensive).
const RULE36_PATTERNS: { pattern: RegExp; flag: string }[] = [
  // ─── 1. Outcome promises ────────────────────────────────────────────────────
  { pattern: /\bguarantee[ds]?\b.*\b(success|win|victory|result|acquit|verdict|judgement|judgment|outcome)\b/i, flag: 'outcome_promise' },
  { pattern: /\b(guaranteed|surely|definitely|certainly|100\s*%?\s*sure|sure[- ]?shot)\b.*\b(win|won|success|acquit|verdict|favor|favour)\b/i, flag: 'outcome_promise' },
  { pattern: /\bi(?:'|’|\s+wi)?ll\s+(win|get\s+you|secure|ensure|guarantee)\s+(your\s+case|the\s+case|an?\s+acquittal|a\s+verdict|justice)\b/i, flag: 'outcome_promise' },
  { pattern: /\b(no[\s-]?win[\s-]?no[\s-]?fee|contingency\s+fee|success[\s-]?fee)\b/i, flag: 'outcome_promise' },
  { pattern: /\byour\s+(case|chances)\s+(are|look|is)\s+(strong|great|excellent|very\s+good|certain|winning)\b/i, flag: 'outcome_promise' },
  { pattern: /\b100\s*%\s*(win|guarantee|success)\b/i, flag: 'outcome_promise' },

  // ─── 2. Self-comparison / advertising ───────────────────────────────────────
  { pattern: /\b(best|top|no[\s.-]?1|number\s+one|leading|most\s+experienced)\s+(lawyer|advocate|attorney|firm)\b/i, flag: 'comparison_claim' },
  { pattern: /\baward[\s-]?winning\s+(lawyer|advocate|attorney)\b/i, flag: 'comparison_claim' },
  { pattern: /\b\d{2,}\s*\+?\s*years\s+experience\b/i, flag: 'comparison_claim' },
  { pattern: /\bi\s+(have\s+)?won\s+\d+\s+cases?\b/i, flag: 'comparison_claim' },

  // ─── 3. Direct-contact solicitation ─────────────────────────────────────────
  // Indian mobile-number patterns (10-digit starting 6-9, optional +91 / 91 / 0 prefix)
  { pattern: /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{9}(?!\d)/, flag: 'contact_solicitation' },
  // International / generic phone shapes (e.g. +1 415 555 1234, 020-1234-5678)
  { pattern: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/, flag: 'contact_solicitation' },
  // Verb + me + at/on/via + number-or-app
  { pattern: /\b(call|text|message|ping|reach|contact|connect|dm|whatsapp)\s+me\s+(at|on|via|directly|personally|privately|outside|off[\s-]?platform)\b/i, flag: 'contact_solicitation' },
  // "my number is", "my phone is", "my contact is"
  { pattern: /\bmy\s+(phone|mobile|cell|contact|number|whatsapp|telegram)\s+(number\s+)?(is|:)?\s*[\d+]/i, flag: 'contact_solicitation' },
  // Standalone messaging apps
  { pattern: /\b(whatsapp|wa\.me|telegram|signal|viber|imo|wechat)\b/i, flag: 'contact_solicitation' },
  // "drop me a line at", "email me at" with @
  { pattern: /\b(email|mail|gmail|yahoo|outlook)\s+me\b/i, flag: 'contact_solicitation' },
  // Standalone email outside platform domain (look-ahead for @)
  { pattern: /[\w.+-]+@(?!legal-?link|hexabytes)[\w.-]+\.[a-z]{2,}/i, flag: 'contact_solicitation' },

  // ─── 4. Fee / charge / payment mention ──────────────────────────────────────
  // Currency symbols / codes followed by digits
  { pattern: /(?:₹|rs\.?|inr|rupees?)\s*\d/i, flag: 'fee_solicitation' },
  // Digits followed by currency words
  { pattern: /\d+\s*(?:rupees?|rs\.?|inr)\b/i, flag: 'fee_solicitation' },
  // "fee/charges/rate/cost ... per hearing/session/case/consultation/visit"
  { pattern: /\b(fees?|charges?|rate|cost|amount|price)\b.*\bper\s+(hearing|session|case|consultation|visit|appearance|matter)\b/i, flag: 'fee_solicitation' },
  // "I charge", "my fee", "my fees", "my charges"
  { pattern: /\b(i\s+charge|my\s+(fee|fees|charges?|rate|price))\b/i, flag: 'fee_solicitation' },
  // Retainer / advance language
  { pattern: /\b(retainer|advance\s+payment|advance\s+deposit|down[\s-]?payment|booking\s+fee)\b/i, flag: 'fee_solicitation' },
  // "pay me directly", "pay cash", "pay in advance"
  { pattern: /\bpay\s+(me|us|directly|cash|advance|first|upfront|in\s+cash|outside)\b/i, flag: 'fee_solicitation' },
  // Discount / cheap framing
  { pattern: /\b(special\s+rate|discount(ed)?\s+(fee|price)|low[\s-]?cost|cheap(est)?\s+(fee|rate|lawyer))\b/i, flag: 'fee_solicitation' },

  // ─── 5. Off-platform payment ────────────────────────────────────────────────
  // Payment apps
  { pattern: /\b(upi|paytm|gpay|g[\s-]?pay|google\s+pay|phonepe|phone[\s-]?pe|bhim|amazon\s+pay|cred|mobikwik|freecharge|payzapp)\b/i, flag: 'off_platform_payment' },
  // UPI ID format (handle@bank)
  { pattern: /\b[\w.-]+@(?:ybl|okhdfcbank|okaxis|oksbi|okicici|paytm|upi|axl|ibl|axisb|hdfcbank|sbi|icici)\b/i, flag: 'off_platform_payment' },
  // Wire / bank transfer language
  { pattern: /\b(bank\s+transfer|wire\s+transfer|neft|imps|rtgs|send\s+(?:money|funds|cash)\s+to)\b/i, flag: 'off_platform_payment' },
  // Account number context
  { pattern: /\b(a\/c|account|ifsc)\s*(no\.?|number|:)?\s*\d{6,}/i, flag: 'off_platform_payment' },

  // ─── 6. Bengali patterns (parallel coverage) ────────────────────────────────
  { pattern: /সাফল্যের?\s*গ্যারান্টি|জয়ের?\s*গ্যারান্টি|নিশ্চিত\s*জয়|১০০%\s*গ্যারান্টি/i, flag: 'outcome_promise' },
  { pattern: /\bসেরা\s*(আইনজীবী|উকিল|অ্যাডভোকেট)/i, flag: 'comparison_claim' },
  { pattern: /সরাসরি\s*যোগাযোগ|হোয়াটসঅ্যাপ|ফোন\s*করুন|আমার\s*নম্বর/i, flag: 'contact_solicitation' },
  { pattern: /আমার\s*ফি|ফি\s*হল|প্রতি\s*শুনানিতে|টাকা\s*নেব|অগ্রিম\s*টাকা|ক্যাশ\s*পেমেন্ট/i, flag: 'fee_solicitation' },
  { pattern: /ইউপিআই|পেটিএম|ফোনপে|গুগল\s*পে|ব্যাঙ্ক\s*ট্রান্সফার|নগদ\s*টাকা\s*পাঠান/i, flag: 'off_platform_payment' },
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
