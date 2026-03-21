const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const API_KEY_PATTERN =
  /\b(?:sk-[a-zA-Z0-9]{20,}|key-[a-zA-Z0-9]{20,}|bearer\s+[a-zA-Z0-9._\-]{20,}|token[_-]?[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16})\b/i;
const PASSWORD_PATTERN = /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i;

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: CREDIT_CARD_PATTERN,
    reason: 'Contains what appears to be a credit card number',
  },
  {
    pattern: SSN_PATTERN,
    reason: 'Contains what appears to be a Social Security Number',
  },
  {
    pattern: API_KEY_PATTERN,
    reason: 'Contains what appears to be an API key or token',
  },
  {
    pattern: PASSWORD_PATTERN,
    reason: 'Contains what appears to be a password',
  },
];

export function isSensitive(text: string): {
  sensitive: boolean;
  reason?: string;
} {
  for (const { pattern, reason } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { sensitive: true, reason };
    }
  }
  return { sensitive: false };
}
