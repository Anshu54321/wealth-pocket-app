/**
 * Device bridge for SMS transaction capture.
 *
 * Two concerns live here and nothing else: the Android READ_SMS permission,
 * and reading the most recent messages from the inbox. All parsing lives in
 * `lib/smsParser.ts` and all persistence in `lib/database.ts`, so this module
 * stays small enough to reason about when a device API changes underneath it.
 *
 * ## Reading the inbox
 *
 * Android has no JavaScript API for the SMS content provider, so a native
 * module is unavoidable. `react-native-get-sms-android` is a bare React Native
 * module: Metro resolves a literal `require` at bundle time and hard-fails the
 * build when the package is missing, which would take down the web and Expo Go
 * previews this repository ships. The reader is therefore injected through
 * `registerSmsReader` instead of imported, which keeps the dependency optional
 * and makes the parse pipeline testable without a device. Without a registered
 * reader the sync screen falls back to `PREVIEW_SMS_MESSAGES` and says so in
 * the UI rather than silently reporting an empty inbox.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  isTransactionSender,
  parseSmsMessages,
  type ParsedSmsTransaction,
  type SmsMessage,
} from './smsParser';

const SMS_SYNC_ENABLED = 'mira.sms-sync.enabled.v1';

/** How many messages one sync pass looks at. */
export const RECENT_SMS_LIMIT = 30;

export type SmsPermissionState =
  /** Android, permission granted. */
  | 'granted'
  /** Android, can still prompt. */
  | 'denied'
  /** Android, user chose "don't ask again" — only Settings can change it. */
  | 'blocked'
  /** iOS, web, or any platform with no SMS content provider. */
  | 'unavailable';

export interface SmsSyncResult {
  /** Messages actually read from the inbox. */
  readonly scanned: number;
  /** Messages discarded because the sender is not a bank or payment rail. */
  readonly skipped: number;
  /** Messages that parsed into a transaction. */
  readonly parsed: readonly ParsedSmsTransaction[];
  readonly inserted: number;
  readonly duplicates: number;
  /** True when the numbers came from the preview dataset, not the inbox. */
  readonly usedPreview: boolean;
}

export type SmsReader = (limit: number) => Promise<SmsMessage[]>;

let reader: SmsReader | null = null;

/**
 * Registers the native inbox reader.
 *
 * Call this once from the app entry point in a development build:
 *
 * ```ts
 * import SmsAndroid from 'react-native-get-sms-android';
 * import { registerSmsReader } from '@/lib/sms';
 *
 * registerSmsReader((limit) => new Promise((resolve, reject) => {
 *   SmsAndroid.list((error, messages) => (error ? reject(error) : resolve(messages)), {
 *     minDate: Date.now() - RECENT_SMS_LIMIT * 86_400_000,
 *     offset: 0,
 *     count: limit,
 *   });
 * }));
 * ```
 */
export function registerSmsReader(next: SmsReader | null): void {
  reader = next;
}

export function hasSmsReader(): boolean {
  return reader !== null;
}

export function isSmsPlatformSupported(): boolean {
  return Platform.OS === 'android';
}

export async function getSmsPermission(): Promise<SmsPermissionState> {
  if (!isSmsPlatformSupported()) return 'unavailable';
  return (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS))
    ? 'granted'
    : 'denied';
}

/**
 * Prompts for READ_SMS.
 *
 * The rationale is required, not decorative: Android only shows it when the
 * app declares the permission in `app.json` and the user has a reason. The copy
 * states what happens to the messages, which is the question users actually
 * have at this prompt.
 */
export async function requestSmsPermission(): Promise<SmsPermissionState> {
  if (!isSmsPlatformSupported()) return 'unavailable';
  if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS)) return 'granted';

  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: 'Let Mira read bank messages?',
    message:
      'Mira reads your latest messages to log spending and income for you. Messages are read only when you tap Sync, parsed on this device, and never uploaded.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED
    ? 'granted'
    : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ? 'blocked'
      : 'denied';
}

/** Whether the user has opted in. Independent of whether the OS granted it. */
export async function isSmsSyncEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(SMS_SYNC_ENABLED)) === 'true';
}

export async function setSmsSyncEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(SMS_SYNC_ENABLED, String(enabled));
}

/**
 * Sample messages used when no native reader is registered.
 *
 * Deliberately covers the shapes that actually break parsers: Indian digit
 * grouping, a trailing balance that must not win, paired credit/debit wording,
 * a UPI reference, an ATM withdrawal with no merchant, and one non-bank sender
 * that must be ignored. Two of them are duplicates of earlier lines so the
 * deduplication counter has something to report.
 */
export const PREVIEW_SMS_MESSAGES: readonly SmsMessage[] = [
  {
    address: 'VM-HDFCBK',
    body: 'HDFC Bank: Rs.1,250.00 debited from A/c XXXX4821 to UPI/AMAZONPAY on 12-Oct. Avl Bal: Rs.42,180.55. UTR: 523419887401',
    timestamp: Date.now() - 3 * 60 * 60 * 1000,
  },
  {
    address: 'AD-SBIINB',
    body: 'Your A/c XXXX9134 has credited INR 85,000.00 from SALARY on 01-Oct-2024. Avl Bal Rs.1,21,940.10',
    timestamp: Date.now() - 20 * 60 * 60 * 1000,
  },
  {
    address: '420345',
    body: 'Rs.450.50 debited at SWIGGY ORDER via UPI to swiggy@paytm. Ref No 445512039881. Avl Bal Rs.9,214.00',
    timestamp: Date.now() - 26 * 60 * 60 * 1000,
  },
  {
    address: 'VM-HDFCBK',
    body: 'Rs.1,250.00 debited from A/c XXXX4821 to UPI/AMAZONPAY. UTR: 523419887401',
    timestamp: Date.now() - 3 * 60 * 60 * 1000,
  },
  {
    address: 'VM-ICICIB',
    body: 'Credited to your A/c XXXX2201 Rs.5,000.00 from ANKUR KUMAR (9876543210) on 02-Oct. Ref: RRN7745120033',
    timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
  },
  {
    address: 'AD-SBIINB',
    body: 'ATM withdrawal of Rs.2,000 at ANDHERI EAST ATM on 28-Sep-2024. Avl Bal Rs.15,300.00',
    timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
  {
    address: '+919812345678',
    body: 'Hey, are we still on for dinner tomorrow?',
    timestamp: Date.now() - 40 * 60 * 1000,
  },
  {
    address: 'VM-BKAXIS',
    body: 'Your A/c XXXXXX77 has been debited by Rs.999.00 towards premium subscription renewal on 30-Sep-2024. UTR: 991155220088',
    timestamp: Date.now() - 4 * 24 * 60 * 60 * 1000,
  },
];

export class SmsReaderMissingError extends Error {
  constructor() {
    super(
      'Reading SMS needs a development build with react-native-get-sms-android linked. Expo Go and web previews use the sample messages instead.',
    );
    this.name = 'SmsReaderMissingError';
  }
}

/** Reads the inbox through the registered native reader. */
async function readInbox(limit: number): Promise<SmsMessage[]> {
  if (!reader) throw new SmsReaderMissingError();
  const messages = await reader(limit);
  return messages.map((message) => ({
    address: typeof message.address === 'string' ? message.address : '',
    body: typeof message.body === 'string' ? message.body : '',
    timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
  }));
}

/**
 * Reads, filters, and parses recent messages.
 *
 * Returns the parsed transactions plus the counts the sync screen reports, and
 * nothing else. Persistence is the caller's job so this function stays free of
 * database concerns and can be exercised on its own.
 */
export async function collectRecentSmsTransactions(
  limit: number = RECENT_SMS_LIMIT,
): Promise<Omit<SmsSyncResult, 'inserted' | 'duplicates'>> {
  const usedPreview = !hasSmsReader();
  const messages = usedPreview ? [...PREVIEW_SMS_MESSAGES] : await readInbox(limit);

  const relevant = messages.filter((message) => isTransactionSender(message.address));
  const parsed = parseSmsMessages(relevant);

  return {
    scanned: messages.length,
    skipped: messages.length - relevant.length,
    parsed,
    usedPreview,
  };
}
