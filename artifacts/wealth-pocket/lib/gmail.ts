import type { TransactionInput } from './database';

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessageResponse {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

export interface ParsedEmailTransaction extends TransactionInput {
  emailMessageId: string;
}

const categoryRules: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /swiggy|zomato|restaurant|cafe|food|blinkit|zepto/i, category: 'Food & dining' },
  { pattern: /uber|ola|rapido|metro|irctc|petrol|fuel|parking|toll/i, category: 'Transport' },
  { pattern: /amazon|flipkart|myntra|ajio|shopping|retail/i, category: 'Shopping' },
  { pattern: /electricity|water bill|broadband|jio|airtel|recharge|gas bill/i, category: 'Bills' },
  { pattern: /mutual fund|sip|zerodha|groww|demat|stock|equity/i, category: 'Investments' },
  { pattern: /lic|insurance|premium/i, category: 'Insurance' },
  { pattern: /salary|payroll|credited|refund|reversal/i, category: 'Income' },
  { pattern: /medical|pharmacy|hospital|apollo|clinic/i, category: 'Health' },
  { pattern: /grocery|supermarket|bigbasket|dmart|reliance fresh/i, category: 'Groceries' },
];

function decodeGmailBody(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function collectText(part: GmailPart | undefined, result: string[]): void {
  if (!part) return;
  if (part.body?.data) {
    try {
      const decoded = decodeGmailBody(part.body.data);
      result.push(part.mimeType === 'text/html'
        ? decoded.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
        : decoded);
    } catch {
      // Invalid MIME bodies are ignored; the message itself is never logged or retained.
    }
  }
  part.parts?.forEach((child) => collectText(child, result));
}

function canonicalMerchant(text: string): string {
  const patterns = [
    /(?:paid|sent|transferred|payment)\s+to\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,42})/i,
    /(?:merchant|beneficiary)\s*[:=-]\s*([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,42})/i,
    /\bto\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,42})/i,
    /(?:purchase|spent)\s+(?:at|on)\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{1,42})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].split(/\s+(?:on|via|using|from|for|dated)\b/i)[0]
        .replace(/[.,;:]+$/, '')
        .trim()
        .slice(0, 80);
    }
  }
  return 'UPI transaction';
}

function parseAmount(text: string): number | null {
  const patterns = [
    /(?:₹|INR|Rs\.?)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /(?:debited|credited|paid|received|transferred)\s+(?:with|by|of|for)?\s*(?:₹|INR|Rs\.?)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const amount = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0 && amount < 100_000_000) {
      return Math.round(amount * 100);
    }
  }
  return null;
}

function parseTimestamp(text: string, fallback: number): number {
  const match = text.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:[T,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i);
  if (match?.[0]) {
    const parsed = Date.parse(match[0].replace(',', ' '));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseUtr(text: string): string | null {
  const match = text.match(/\b(?:UTR|RRN|UPI\s*(?:ref(?:erence)?|ID)|transaction\s*ID|txn\s*ID|reference\s*(?:no|number))\s*[:#=-]?\s*([A-Z0-9]{8,30})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function categoryFor(text: string): { category: string; kind: TransactionInput['kind']; bucket?: string } {
  const investment = /mutual fund|sip|zerodha|groww|demat|stock|equity|lic premium|insurance premium/i.test(text);
  if (investment) {
    const bucket = /lic|insurance/i.test(text) ? 'Insurance'
      : /stock|equity|demat|zerodha/i.test(text) ? 'Stocks'
        : /emergency/i.test(text) ? 'Emergency fund' : 'Mutual funds';
    return { category: bucket, kind: 'investment', bucket };
  }
  const received = /credited|received|deposit(?:ed)?|refund|reversal|salary|cashback/i.test(text);
  if (received) return { category: 'Income', kind: 'income' };
  const match = categoryRules.find((rule) => rule.pattern.test(text));
  return { category: match?.category ?? 'Needs review', kind: 'expense' };
}

export function parseTransactionEmail(
  message: GmailMessageResponse,
): ParsedEmailTransaction | null {
  const payload = message.payload;
  if (!payload) return null;
  const bodies: string[] = [];
  collectText(payload, bodies);
  if (payload.body?.data) collectText({ mimeType: 'text/plain', body: payload.body }, bodies);
  const text = bodies.join('\n').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const amountMinor = parseAmount(text);
  if (!amountMinor) return null;
  const headers = payload.headers ?? [];
  const subject = headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? '';
  const dateHeader = headers.find((header) => header.name.toLowerCase() === 'date')?.value;
  const fallbackTime = Number(message.internalDate) || Date.parse(dateHeader ?? '') || Date.now();
  const details = `${subject} ${text}`;
  const classification = categoryFor(details);

  return {
    amountMinor,
    merchant: canonicalMerchant(details),
    category: classification.category,
    kind: classification.kind,
    occurredAt: parseTimestamp(text, fallbackTime),
    utr: parseUtr(details),
    source: 'gmail',
    emailMessageId: message.id,
    investmentBucket: classification.bucket,
  };
}

async function gmailRequest<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new Error('Google access expired. Reconnect your account to sync.');
  if (response.status === 403) throw new Error('Gmail read access was not granted. Reconnect and allow the read-only permission.');
  if (!response.ok) throw new Error(`Gmail returned an error (${response.status}). Try again in a moment.`);
  return response.json() as Promise<T>;
}

export async function fetchRecentGmailTransactions(token: string): Promise<ParsedEmailTransaction[]> {
  const list = await gmailRequest<GmailListResponse>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than%3A30d%20-category%3Apromotions%20-category%3Asocial&maxResults=75',
    token,
  );
  const results: ParsedEmailTransaction[] = [];
  for (const item of list.messages ?? []) {
    const message = await gmailRequest<GmailMessageResponse>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
      token,
    );
    const parsed = parseTransactionEmail(message);
    if (parsed) results.push(parsed);
  }
  return results;
}