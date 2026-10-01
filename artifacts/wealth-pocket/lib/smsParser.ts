/**
 * Bank SMS parsing for automatic transaction capture.
 *
 * Deliberately dependency-free and side-effect-free: every function here takes
 * a string and returns a value, so the rules below can be exercised directly
 * against real message text. Nothing in this file reads the device, writes to
 * the database, or retains the raw message body.
 *
 * Design rules that the rest of the feature depends on:
 *
 * - A message is only accepted when it carries both a rupee amount and an
 *   explicit direction word ("debited", "credited"). Anything less is a guess,
 *   and a guessed transaction is worse than a skipped one because it silently
 *   moves the user's balance.
 * - Balances are not amounts. "Avl Bal Rs.12,300" trailing a real transaction
 *   would otherwise win the match and inflate the ledger, so balance-shaped
 *   numbers are collected first and excluded.
 * - The transaction timestamp is always the time the device received the
 *   message, never a date parsed out of the body. Bank date formats vary by
 *   issuer and several are ambiguous (01-02-2025); the receive time cannot be.
 */

import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  INVESTMENT_CATEGORIES,
  type CategoryDefinition,
} from '@/constants/categories';
import type { TransactionKind } from './database';

export interface SmsMessage {
  /** Sender address or shortcode, e.g. `VM-HDFCBK` or a 6-digit bank code. */
  readonly address: string;
  readonly body: string;
  /** Device receive time in epoch milliseconds. */
  readonly timestamp: number;
}

export interface ParsedSmsTransaction {
  readonly amountMinor: number;
  readonly merchant: string;
  readonly kind: TransactionKind;
  readonly category: string;
  readonly occurredAt: number;
  /** Bank reference (UPI ref, RRN, txn id) when the message carries one. */
  readonly utr: string | null;
  /**
   * Deduplication key, named to match `TransactionInput.smsFingerprint` so the
   * value flows from here into the insert without a rename step. An earlier
   * mismatch between the two names silently disabled deduplication entirely,
   * which is the failure mode this comment exists to prevent.
   */
  readonly smsFingerprint: string;
  readonly investmentBucket?: string;
}

export type SmsDirection = 'expense' | 'income';

/** Upper bound sanity check; anything larger is a balance, an ID, or junk. */
const MAX_PLAUSIBLE_AMOUNT_MINOR = 100_000_000 * 100;

/**
 * Currency prefix. `Rs.` is written with and without the period, and as `Rs`
 * bare, across essentially every Indian issuer template.
 */
const CURRENCY = String.raw`(?:₹|rs\.?|inr)`;
const AMOUNT_NUMBER = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;

/**
 * A balance label sitting immediately before a rupee amount.
 *
 * The optional verb bridges the two templates issuers actually use: HDFC writes
 * "Avl Bal: Rs.42,180.55" while ICICI writes "Balance is Rs.42,180.55".
 *
 * Anchored at the end so it can be tested against the text preceding one specific
 * candidate amount. Comparing offsets between two separate regex passes would be
 * wrong: a balance match starts at the label ("Avl Bal:") while an amount match
 * starts at the currency symbol, so their indices never line up.
 */
const BALANCE_LABEL_BEFORE = new RegExp(
  String.raw`(?:avl|avail|available|closing|opening|bal|balance|total|limit|current)`
    + String.raw`[\s.]*(?:balance|bal)?[\s:=-]*(?:(?:is|was|of|as)\b[\s:=-]*)?$`,
  'i',
);

/**
 * A money amount followed by an outbound preposition, e.g. "Rs.450 to
 * Zomato". Used to break the tie when one message contains both a credit word
 * and a debit word.
 */
const OUTBOUND_MONEY = new RegExp(
  String.raw`(?:transferred|paid|sent|remitted)\s+(?:the\s+)?(?:amount\s+|funds\s+)?(?:of\s+)?${CURRENCY}\s*[\d,.]+\s*to\b`,
  'i',
);

/** Direction words, strongest first. */
const EXPENSE_PATTERNS: readonly RegExp[] = [
  /\b(?:transferred|transfer|paid|pay|sent|remitted)\s+(?:the\s+)?(?:amount\s+|funds\s+)?(?:of\s+)?(?:rs\.?|inr|₹)?\s*[\d,.]+\s*(?:to|for)\b/i,
  /\btransferred?\s+to\b/i,
  /\bpaid\s+to\b/i,
  /\bpayment\s+(?:to|of)\b/i,
  /\bsent\s+to\b/i,
  /\bmoney\s+transferred\s+to\b/i,
  /\bdebited\b/i,
  /\bdebit(?:s|ted)?\s+(?:from|by)\b/i,
  /\bwithdrawn\b/i,
  /\bwithdrawal\b/i,
  /\batm\s+withdraw/i,
  /\bspent\b/i,
  /\bcharged\b/i,
  /\bpurchas(?:e|ed)\b/i,
  /\bdebit\s*card\b/i,
];

const INCOME_PATTERNS: readonly RegExp[] = [
  /\bcredited\s+(?:by|from)\b/i,
  /\bcredit(?:s|ed)?\s+(?:to|in)\b/i,
  /\btransferred?\s+from\b/i,
  /\breceived\s+(?:from|by)\b/i,
  /\bpaid\s+(?:by|to\s+you)\b/i,
  /\brefund(?:ed)?\b/i,
  /\breversal?\b/i,
  /\breversed\b/i,
  /\bdeposited\b/i,
  /\bdeposit\s+credited\b/i,
  /\bcredited\b/i,
  /\breceived\b/i,
  /\bsalary\b/i,
  /\bcashback\b/i,
];

/**
 * Token noise that regularly trails a merchant name because the template
 * continues into a new clause. Cutting here keeps "Zomato on 12-Oct" from being
 * stored as the merchant.
 */
const MERCHANT_TAIL_NOISE = /\s+(?:on|via|using|through|dated|ref|reference|utr|rrn|txn|transaction|with|and|a\/c|bal|balance|avl|is|has|was|using|for|refunded?)\b.*$/i;

/** Characters a merchant name is allowed to contain once noise is stripped. */
const MERCHANT_ALLOWED = /[^A-Za-z0-9 .&'@_+/-]/g;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Decides the direction of the movement.
 *
 * Expense wording is tested first because the common templates pair a credit
 * word with a debit role in the same sentence ("credited ... to your account
 * ... amount debited"), and letting the credit word win would flip a spend into
 * income. The `from`/`to` pairs are ordered within each list so a directional
 * preposition outranks a bare verb.
 */
export function detectDirection(text: string): SmsDirection | null {
  const expense = EXPENSE_PATTERNS.some((pattern) => pattern.test(text));
  const income = INCOME_PATTERNS.some((pattern) => pattern.test(text));
  if (expense && income) {
    // Both signals present, which the paired-clause templates produce:
    // "credited to your account ... Rs.450 debited to Zomato". The preposition
    // attached to the money names the counterparty and therefore decides
    // direction; a bare "credited" in the same sentence is just a balance
    // update and must not win.
    return OUTBOUND_MONEY.test(text) || /\bdebited\b/i.test(text) ? 'expense' : 'income';
  }
  if (expense) return 'expense';
  if (income) return 'income';
  return null;
}

function toMinor(digits: string): number | null {
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  if (minor > MAX_PLAUSIBLE_AMOUNT_MINOR) return null;
  return minor;
}

/**
 * Currency-prefixed amounts anywhere in the message.
 *
 * Indian grouping means "1,23,456" is one number, not three, so commas stay in
 * the pattern and are stripped once the match is captured.
 */
function findCurrencyAmounts(text: string): Array<{ index: number; minor: number }> {
  const pattern = new RegExp(String.raw`${CURRENCY}\s*${AMOUNT_NUMBER}`, 'gi');
  const found: Array<{ index: number; minor: number }> = [];
  let match = pattern.exec(text);
  while (match) {
    const minor = toMinor(match[1]);
    if (minor !== null) found.push({ index: match.index, minor });
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Bare amounts immediately following a direction word, used only when the
 * message states the number without a currency marker: "Debited: 450.00".
 */
function findLabelledAmounts(text: string): Array<{ index: number; minor: number }> {
  const pattern = new RegExp(
    String.raw`(?:debited|credited|paid|spent|withdrawn|received|refunded|transferred)`
      + String.raw`\s*(?:by|on|to|from|:|-)?\s*(?:${CURRENCY}\s*)?${AMOUNT_NUMBER}`,
    'gi',
  );
  const found: Array<{ index: number; minor: number }> = [];
  let match = pattern.exec(text);
  while (match) {
    const minor = toMinor(match[1]);
    if (minor !== null) found.push({ index: match.index, minor });
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Picks the transaction amount, skipping any that a balance label introduces.
 *
 * "Avl Bal ₹5,000.00. ₹750 debited to NETFLIX" carries two numbers and only the
 * second is a transaction; taking the first would overstate the spend fourfold.
 *
 * Currency-prefixed amounts win over bare ones because a bare number is far
 * more likely to be an account number fragment or a date than a rupee value.
 */
export function findTransactionAmount(text: string): number | null {
  const currency = findCurrencyAmounts(text).filter(
    (entry) => !BALANCE_LABEL_BEFORE.test(text.slice(0, entry.index)),
  );
  const candidates = currency.length > 0 ? currency : findLabelledAmounts(text);
  return candidates.length > 0 ? candidates[0].minor : null;
}

/** Reduces a raw capture to a storable merchant name. */
function cleanMerchant(raw: string): string {
  const withoutTail = normalizeWhitespace(raw.replace(MERCHANT_TAIL_NOISE, ''));
  const cleaned = withoutTail
    // Leading template noise, applied repeatedly because templates stack them:
    // "the merchant PAYTM" is "the", then "merchant", then the name.
    .replace(/^(?:(?:the|a|an|upi|merchant|beneficiary|payee|seller|counterparty)\s+)+/i, '')
    .replace(MERCHANT_ALLOWED, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:.,]+|[\s\-:.,]+$/g, '')
    .trim();
  return cleaned.slice(0, 80);
}

/** Strips a `UPI/` prefix and a TLD, so `swiggy@paytm` reads as `Swiggy`. */
function fromVpa(vpa: string): string {
  return cleanMerchant(vpa.split('@')[0]);
}

/**
 * Extracts the counterparty named in the message body, or `null` when the body
 * does not name one.
 *
 * Order encodes confidence: an explicit `to`/`from` preposition is a real
 * counterparty, a VPA is a strong merchant signal, `at` is usually a merchant
 * for card and UPI spends, and `for` is the weakest because it also appears in
 * marketing copy.
 *
 * ATM withdrawals are matched ahead of the generic `at` patterns because their
 * template ("ATM withdrawal of Rs.2,000 at ANDHERI EAST ATM") carries no
 * transaction verb for the generic rules to key on.
 *
 * Returning `null` rather than a fallback matters downstream: the sender
 * address is the bank, not the counterparty, and feeding it to the category
 * matchers produces nonsense (Axis Bank's shortcode `VM-AXIS` satisfies the
 * `/axis/` investment matcher). The caller substitutes a display label after
 * categorisation instead.
 */
export function extractMerchant(text: string, direction: SmsDirection): string | null {
  const candidates: string[] = [];

  if (direction === 'expense') {
    const toPatterns = [
      /(?:transferred|paid|sent|remitted)\s+(?:the\s+)?(?:amount\s+|funds\s+)?(?:of\s+)?(?:${CURRENCY}\s*[\d,.]+\s*)?(?:to|for)\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
      /(?:payment|txn|transaction)\s+(?:to|of)\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
      /(?:to|credited\s+to)\s+((?:UPI\s*\/\s*)?[A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
    ];
    for (const pattern of toPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) candidates.push(match[1]);
    }
  } else {
    const fromPatterns = [
      /(?:credited|received|remitted|paid)\s+(?:by|from)\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
      /(?:transferred|received)\s+from\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
      /(?:salary|interest|dividend|refund)\s+(?:from|for)\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
      // Last resort: issuers interleave the account number and amount between
      // the verb and the originator, as in "Credited to your A/c XXXX2201
      // Rs.5,000.00 from ANKUR KUMAR". Periods are allowed in the gap because
      // rupee amounts contain them; semicolons are not, so this cannot run on
      // into a different sentence.
      /\b(?:credited|received|remitted|deposited)\b[^;]{0,80}?\bfrom\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
    ];
    for (const pattern of fromPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) candidates.push(match[1]);
    }
  }

  const atmPatterns = [
    /\b(?:atm\s+)?withdraw(?:al|ed)?\s+(?:of\s+${CURRENCY}\s*[\d,.]+\s*)?(?:at|on)\s+([A-Za-z0-9][\w &'/-]{1,40})/i,
    /\bat\s+([A-Za-z0-9][\w &'/-]{0,38}\bATM)\b/i,
  ];
  for (const pattern of atmPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }

  const vpa = text.match(/\b([A-Za-z0-9][\w.-]{1,30}@[A-Za-z][\w.-]{1,20})\b/);
  if (vpa?.[1]) candidates.push(fromVpa(vpa[1]));

  const atMerchant = text.match(
    /\b(?:spent\s+(?:at|on)|charged\s+at|purchase[ds]?\s+(?:at|on)|debit(?:ed)?\s+at|payment\s+(?:at|to))\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i,
  );
  if (atMerchant?.[1]) candidates.push(atMerchant[1]);

  const forMerchant = text.match(/\bfor\s+([A-Za-z0-9][\w .&'@_+/-]{1,60})/i);
  if (forMerchant?.[1]) candidates.push(forMerchant[1]);

  for (const candidate of candidates) {
    const withoutPrefix = candidate.replace(/^UPI\s*\/\s*/i, '');
    // A counterparty captured as a VPA reads better without the handle: the
    // brand is what the user recognises in the ledger.
    const source = withoutPrefix.includes('@') ? withoutPrefix.split('@')[0] : withoutPrefix;
    const cleaned = cleanMerchant(source);
    // Single letters and pure numerics are account-number fragments, not names.
    if (cleaned.length >= 2 && /[A-Za-z]/.test(cleaned) && !/^\d+$/.test(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Display label for a message whose body named no counterparty.
 *
 * Only used once categorisation has already run, since the sender identifies
 * the bank rather than the party to the transaction.
 */
function senderLabel(address: string, direction: SmsDirection): string {
  const sender = cleanMerchant(address.replace(/^(?:VM|AD|VD|SP|BK)-/i, ''));
  if (sender.length >= 2 && /[A-Za-z]/.test(sender)) return sender;
  return direction === 'expense' ? 'Card payment' : 'Money received';
}

/**
 * Extracts the bank's own reference.
 *
 * The glued branch runs first so a template that writes "RRN7745120033" with no
 * separator keeps the whole token. That string is what the user would read off
 * to their bank in a dispute, so truncating the issuer prefix is a small loss
 * for a large gain in traceability.
 */
export function extractUtr(text: string): string | null {
  const glued = text.match(
    /\b((?:UTR|RRN|UPIREF|UPIREFNO|TXNID|TXNREF|REFNO|CHQNO|REF)[A-Z0-9]{6,30})\b/i,
  );
  if (glued?.[1]) return glued[1].toUpperCase();

  const labelled = text.match(
    /\b(?:UTR|RRN|UPI\s*(?:ref(?:erence)?|ID)|txn\s*(?:id|ref)|transaction\s*(?:id|ref)|reference\s*(?:no|number)|ref\s*(?:no|id)?|chq\s*no)\s*[:#=-]?\s*([A-Za-z0-9]{8,30})\b/i,
  );
  return labelled?.[1]?.toUpperCase() ?? null;
}

/**
 * Resolves a category from the category registry rather than a local rule
 * table, so a category added to `constants/categories.ts` starts matching SMS
 * text immediately instead of needing a second edit here.
 *
 * The haystack is lower-cased first because the registry's matchers are written
 * in lower case and expected to be tested against lower case. That is the
 * contract `categoryIcon` already relies on, and it matters here specifically:
 * bank alerts are conventionally upper case (`AMAZONPAY`, `DEBITED`), so testing
 * raw text would fail on exactly the messages this feature exists to read.
 */
function matchCategory(
  haystack: string,
  definitions: readonly CategoryDefinition[],
): string | null {
  const lowered = haystack.toLowerCase();
  const hit = definitions.find((definition) =>
    definition.matchers.some((matcher) => matcher.test(lowered)),
  );
  return hit?.name ?? null;
}

/**
 * Removes the issuer name from the front of a bank alert.
 *
 * Needed because the issuer's own name is not evidence about the
 * transaction: "HDFC Bank:" otherwise satisfies the mutual-funds matcher
 * `/hdfc/`, so every rupee spent from an HDFC account would be filed as an
 * investment. Both conventions are covered, the spelled-out bank name and the
 * bare shortcode some aggregators prepend.
 */
function stripIssuerHeader(text: string): string {
  return text.replace(
    /^\s*(?:[A-Za-z0-9 .&'-]{1,28}\s+(?:bank|banking|financial|finance|capital)\s*:|[A-Za-z0-9-]{2,12}:)\s*/i,
    '',
  );
}

/**
 * Removes everything from a bank alert that is not evidence of what was bought.
 *
 * Two kinds of noise have to go:
 *
 * - The issuer name. "HDFC Bank:" otherwise satisfies the mutual-funds matcher
 *   `/hdfc/`, so every rupee spent from an HDFC account would be filed as an
 *   investment.
 * - The direction verbs. They are the words the category matchers collide with
 *   most often: `debited` contains `eat`, which is the Food & dining matcher.
 *   Without this, every debit in every template would be categorised as a meal.
 *
 * Only the fallback path uses this. The merchant name is already clean evidence.
 */
function categoryEvidence(text: string): string {
  return stripIssuerHeader(text).replace(
    /\b(?:debited|credited|spent|paid|received|transferred|remitted|withdrawn|withdrawal|charged|charge[ds]?|purchased|deposited|deposit|reversed|refunded|withdraw)\b/gi,
    ' ',
  );
}

/**
 * Merchant first, whole message second.
 *
 * The order is load-bearing. The counterparty name carries the actual intent,
 * and the message body is only consulted when it does not, as with "towards
 * premium subscription renewal".
 */
function resolveCategory(
  merchant: string | null,
  text: string,
  definitions: readonly CategoryDefinition[],
): string | null {
  if (merchant) {
    const byMerchant = matchCategory(merchant, definitions);
    if (byMerchant) return byMerchant;
  }
  return matchCategory(categoryEvidence(text), definitions);
}

/**
 * Income direction is unambiguous, so an unmatched credit is still filed as
 * real income rather than pushed into the review queue. Expenses are the
 * opposite: merchant wording varies too much across issuers to categorise on a
 * guess, so anything unmatched becomes "Needs review" and surfaces in the
 * existing review flow.
 */
function categorize(
  merchant: string | null,
  text: string,
  direction: SmsDirection,
): { category: string; bucket?: string } {
  const investment = resolveCategory(merchant, text, INVESTMENT_CATEGORIES);
  if (investment) return { category: investment, bucket: investment };

  if (direction === 'income') {
    return { category: resolveCategory(merchant, text, INCOME_CATEGORIES) ?? 'Other income' };
  }
  return { category: resolveCategory(merchant, text, EXPENSE_CATEGORIES) ?? 'Needs review' };
}

/**
 * Builds the deduplication key.
 *
 * A UTR is unique per transaction at the bank, so when the message carries one
 * it is the whole key. Without one, the key is day + amount + direction +
 * merchant, which is what the feature asks for: re-reading the same message
 * produces the same key, so the second sync silently drops it.
 *
 * Direction is included because paying a friend and being paid by them on the
 * same day for the same amount are two real transactions, not one.
 */
export function buildSmsFingerprint(
  occurredAt: number,
  amountMinor: number,
  kind: TransactionKind,
  merchant: string,
  utr: string | null,
): string {
  if (utr) return `utr:${utr}`;
  const date = new Date(occurredAt);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const merchantKey = merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `d:${day}|${Math.round(amountMinor)}|${kind}|${merchantKey}`;
}

/**
 * True for sender addresses whose messages can contain a transaction.
 *
 * The set is wider than "banks" on purpose. Merchants that push UPI alerts send
 * them from their own DLT-registered shortcode (`VM-ZOMATO`), and those
 * messages carry a debit just as a bank's does, so excluding them would drop
 * real spending. Personal numbers and brand chat senders (`+9198…`, `AMAZON
 * SUPPORT`) are excluded so the scan never reads a conversation as spending.
 */
export function isTransactionSender(address: string): boolean {
  const value = address.trim();
  if (!value) return false;
  // 6-digit Indian bank shortcodes, e.g. 420345 for a bank OTP relay.
  if (/^\d{6}$/.test(value)) return true;
  // DLT-registered templates: VM-HDFCBK, AD-SBIINB, VD-ICICIB, VM-ZOMATO.
  if (/^(?:VM|AD|VD|SP|BK|FM|SM)-[A-Z0-9]{2,10}$/i.test(value)) return true;
  return /bank|hsbc|icici|hdfc|sbi|axis|kotak|indusind|yes ?bank|idfc|pnb|bob|canara|union ?bank|paytm|phonepe|google ?pay|bharatpe/i.test(value);
}

/**
 * Parses one message body.
 *
 * Returns `null` whenever a required field is missing or ambiguous, which the
 * sync screen reports as "skipped" rather than guessing. Raw text is never
 * returned, so nothing downstream can persist the message itself.
 */
export function parseSmsMessage(message: SmsMessage): ParsedSmsTransaction | null {
  const text = normalizeWhitespace(message.body);
  if (!text) return null;

  const direction = detectDirection(text);
  if (!direction) return null;

  const amountMinor = findTransactionAmount(text);
  if (amountMinor === null) return null;

  const counterparty = extractMerchant(text, direction);
  const utr = extractUtr(text);
  const classification = categorize(counterparty, text, direction);
  // Labelled only after categorisation, so the sender never reaches the matchers.
  const merchant = counterparty ?? senderLabel(message.address, direction);

  return {
    amountMinor,
    merchant,
    kind: direction,
    category: classification.category,
    occurredAt: message.timestamp,
    utr,
    smsFingerprint: buildSmsFingerprint(message.timestamp, amountMinor, direction, merchant, utr),
    ...(classification.bucket ? { investmentBucket: classification.bucket } : {}),
  };
}

/** Parses a batch, dropping anything unusable. */
export function parseSmsMessages(messages: readonly SmsMessage[]): ParsedSmsTransaction[] {
  const parsed: ParsedSmsTransaction[] = [];
  for (const message of messages) {
    const result = parseSmsMessage(message);
    if (result) parsed.push(result);
  }
  return parsed;
}
