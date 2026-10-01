import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { getOrCreateDatabaseKey } from './security';
import type { DemoDataset } from './demoData';

export type TransactionKind = 'expense' | 'income' | 'investment';
export type TransactionSource = 'manual' | 'gmail' | 'sms';

export interface TransactionRecord {
  id: string;
  amountMinor: number;
  merchant: string;
  category: string;
  kind: TransactionKind;
  occurredAt: number;
  utr: string | null;
  source: TransactionSource;
  emailMessageId: string | null;
  smsFingerprint: string | null;
}

export interface InvestmentRecord {
  id: string;
  transactionId: string;
  bucket: string;
  provider: string | null;
  amountMinor: number;
  contributedAt: number;
}

export type AppNotificationKind = 'reminder' | 'review' | 'lending' | 'sync' | 'system';

export interface AppNotificationRecord {
  id: string;
  createdAt: number;
  readAt: number | null;
  kind: AppNotificationKind;
  title: string;
  body: string;
  action: string | null;
  transactionId: string | null;
  debtId: string | null;
}

export interface AppNotificationInput {
  kind: AppNotificationKind;
  title: string;
  body: string;
  action?: string | null;
  transactionId?: string | null;
  debtId?: string | null;
}

export interface DebtRecord {
  id: string;
  borrower: string;
  phone: string | null;
  principalMinor: number;
  repaidMinor: number;
  interestRate: number;
  givenAt: number;
  dueAt: number;
  status: 'active' | 'settled';
  notificationId: string | null;
}

export interface TransactionInput {
  amountMinor: number;
  merchant: string;
  category: string;
  kind: TransactionKind;
  occurredAt: number;
  source?: TransactionSource;
  utr?: string | null;
  emailMessageId?: string | null;
  /** Stable per-transaction key used to drop repeat SMS on every later sync. */
  smsFingerprint?: string | null;
  investmentBucket?: string;
  provider?: string | null;
}

export interface DebtInput {
  borrower: string;
  phone?: string | null;
  principalMinor: number;
  interestRate: number;
  givenAt: number;
  dueAt: number;
}

export interface FinanceSnapshot {
  transactions: TransactionRecord[];
  investments: InvestmentRecord[];
  debts: DebtRecord[];
  notifications: AppNotificationRecord[];
}

let database: SQLiteDatabase | null = null;
let opening: Promise<SQLiteDatabase> | null = null;

const HOUR = 60 * 60 * 1000;

const DATABASE_KEY_PATTERN = /^[a-f0-9]{64}$/i;

/** Bump alongside an idempotent migration in the setup script below. */
const SCHEMA_VERSION = 3;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * v2 -> v3, adding SMS capture: widen the `source` CHECK constraint to accept
 * `'sms'` and add the `sms_fingerprint` column that deduplication relies on.
 *
 * SQLite cannot relax a CHECK constraint or add a UNIQUE-indexed column with
 * ALTER TABLE, so the table is rebuilt. Three details make that safe:
 *
 * - `PRAGMA foreign_keys` is a silent no-op inside a transaction, so it is
 *   toggled around the rebuild instead of within it. With enforcement left on,
 *   `DROP TABLE transactions` would be rejected by `investments`' foreign key.
 * - Every existing row is copied with `INSERT OR IGNORE`, so a partially
 *   populated table cannot abort the upgrade on a primary-key collision.
 * - Indexes are recreated after the rename because dropping a table drops the
 *   indexes that hang off it.
 *
 * The rebuild runs inside one transaction, so a failure anywhere leaves the
 * original table intact rather than half-migrated.
 */
async function migrateToSmsSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE transactions_v3 (
          id TEXT PRIMARY KEY NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          merchant TEXT NOT NULL,
          category TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'investment')),
          occurred_at INTEGER NOT NULL,
          utr TEXT,
          source TEXT NOT NULL CHECK (source IN ('manual', 'gmail', 'sms')),
          email_message_id TEXT,
          sms_fingerprint TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO transactions_v3
          (id, amount_minor, merchant, category, kind, occurred_at, utr, source,
            email_message_id, sms_fingerprint, created_at)
        SELECT id, amount_minor, merchant, category, kind, occurred_at, utr,
          CASE WHEN source IN ('gmail', 'sms') THEN source ELSE 'manual' END,
          email_message_id, NULL, created_at
        FROM transactions;
        DROP TABLE transactions;
        ALTER TABLE transactions_v3 RENAME TO transactions;
        CREATE UNIQUE INDEX IF NOT EXISTS transactions_utr_unique
          ON transactions(upper(utr)) WHERE utr IS NOT NULL AND trim(utr) <> '';
        CREATE UNIQUE INDEX IF NOT EXISTS transactions_email_message_unique
          ON transactions(email_message_id) WHERE email_message_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS transactions_sms_fingerprint_unique
          ON transactions(sms_fingerprint) WHERE sms_fingerprint IS NOT NULL;
        CREATE INDEX IF NOT EXISTS transactions_occurred_idx
          ON transactions(occurred_at DESC);
        CREATE INDEX IF NOT EXISTS transactions_category_idx
          ON transactions(category, occurred_at DESC);
      `);
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

/** True for the unique-index collision that deduplication deliberately races. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

let warnedAboutWebStorage = false;

/**
 * Stands in for the real database when the bundle runs in a browser.
 *
 * `expo-sqlite` opens a Web Worker to reach its WASM build, and that Worker
 * throws during startup in a plain `expo start --web` session, taking the whole
 * app down before the first render. Returning an inert object keeps the UI
 * previewable on localhost.
 *
 * It is deliberately inert rather than backed by IndexedDB or localStorage: a
 * write that silently disappears is far more dangerous than an empty screen,
 * because the app would look like it had saved data. Only the five entry points
 * this module actually calls are implemented, so a future call that is missed
 * surfaces as a clear "not a function" here instead of being silently absorbed.
 */
const INERT_WEB_DATABASE = {
  getAllAsync: async () => [],
  getFirstAsync: async () => null,
  runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
  execAsync: async () => undefined,
  withTransactionAsync: async (task: () => Promise<void>) => task(),
} as unknown as SQLiteDatabase;

/**
 * False in a browser, where reads return nothing and writes are discarded.
 *
 * Exposed so a screen can say so out loud rather than letting the user conclude
 * their transactions were saved.
 */
export function isPersistentStorageAvailable(): boolean {
  return Platform.OS !== 'web';
}

async function getDatabase(): Promise<SQLiteDatabase> {
  if (database) return database;
  if (opening) return opening;

  if (Platform.OS === 'web') {
    if (!warnedAboutWebStorage) {
      warnedAboutWebStorage = true;
      console.warn(
        '[mira] Browser build: local SQLite storage is unavailable, so this session shows no saved '
        + 'transactions and anything you add is discarded. Verify persistence on a device.',
      );
    }
    return INERT_WEB_DATABASE;
  }

  opening = (async () => {
    const db = await SQLite.openDatabaseAsync('mira-finance.db');
    const key = await getOrCreateDatabaseKey();
    // SQLite does not accept bound parameters in PRAGMA statements, so the key
    // cannot be parameterized here. The strict allow-list below is what makes the
    // interpolation safe: only lowercase hex characters can ever reach the string.
    if (!DATABASE_KEY_PATTERN.test(key)) {
      throw new Error('The local database key is malformed. Reinstalling the app will regenerate it.');
    }
    await db.execAsync(`PRAGMA key = '${key.toLowerCase()}';`);
    await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = Number(versionRow?.user_version ?? 0);
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error('This Mira database was created by a newer app version. Update Mira before opening it.');
    }
    // Runs before the CREATE statements below, because those reference the
    // sms_fingerprint column that only exists after the migration.
    if (currentVersion > 0 && currentVersion < SCHEMA_VERSION) {
      await migrateToSmsSchema(db);
    }
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        merchant TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'investment')),
        occurred_at INTEGER NOT NULL,
        utr TEXT,
        source TEXT NOT NULL CHECK (source IN ('manual', 'gmail', 'sms')),
        email_message_id TEXT,
        sms_fingerprint TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_utr_unique
        ON transactions(upper(utr)) WHERE utr IS NOT NULL AND trim(utr) <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_email_message_unique
        ON transactions(email_message_id) WHERE email_message_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_sms_fingerprint_unique
        ON transactions(sms_fingerprint) WHERE sms_fingerprint IS NOT NULL;
      CREATE INDEX IF NOT EXISTS transactions_occurred_idx
        ON transactions(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS transactions_category_idx
        ON transactions(category, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS merchant_mappings (
        merchant_key TEXT PRIMARY KEY NOT NULL,
        merchant TEXT NOT NULL,
        category TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS investments (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
        bucket TEXT NOT NULL,
        provider TEXT,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        contributed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS investments_bucket_idx
        ON investments(bucket, contributed_at DESC);

      CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY NOT NULL,
        borrower TEXT NOT NULL,
        phone TEXT,
        principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
        repaid_minor INTEGER NOT NULL DEFAULT 0 CHECK (repaid_minor >= 0),
        interest_rate REAL NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
        given_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
        notification_id TEXT
      );
      CREATE INDEX IF NOT EXISTS debts_due_idx ON debts(status, due_at);

      CREATE TABLE IF NOT EXISTS schema_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_meta(id, version) VALUES (1, ${SCHEMA_VERSION});

      CREATE TABLE IF NOT EXISTS app_notifications (
        id TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL,
        read_at INTEGER,
        kind TEXT NOT NULL CHECK (kind IN ('reminder', 'review', 'lending', 'sync', 'system')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        action TEXT,
        transaction_id TEXT,
        debt_id TEXT
      );
      CREATE INDEX IF NOT EXISTS app_notifications_created_idx
        ON app_notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS app_notifications_unread_idx
        ON app_notifications(read_at) WHERE read_at IS NULL;
    `);
    if (currentVersion < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    database = db;
    return db;
  })();

  try {
    return await opening;
  } catch (error) {
    opening = null;
    throw error;
  }
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}

export async function getFinanceSnapshot(): Promise<FinanceSnapshot> {
  const db = await getDatabase();
  const [transactions, investments, debts, notifications] = await Promise.all([
    db.getAllAsync<TransactionRecord>(
      `SELECT id, amount_minor AS amountMinor, merchant, category, kind,
        occurred_at AS occurredAt, utr, source,
        email_message_id AS emailMessageId,
        sms_fingerprint AS smsFingerprint
       FROM transactions ORDER BY occurred_at DESC LIMIT 1000`,
    ),
    db.getAllAsync<InvestmentRecord>(
      `SELECT id, transaction_id AS transactionId, bucket, provider,
        amount_minor AS amountMinor, contributed_at AS contributedAt
       FROM investments ORDER BY contributed_at DESC`,
    ),
    db.getAllAsync<DebtRecord>(
      `SELECT id, borrower, phone, principal_minor AS principalMinor,
        repaid_minor AS repaidMinor, interest_rate AS interestRate,
        given_at AS givenAt, due_at AS dueAt, status,
        notification_id AS notificationId
       FROM debts ORDER BY due_at ASC`,
    ),
    db.getAllAsync<AppNotificationRecord>(
      `SELECT id, created_at AS createdAt, read_at AS readAt, kind, title, body,
        action, transaction_id AS transactionId, debt_id AS debtId
       FROM app_notifications ORDER BY created_at DESC LIMIT 200`,
    ),
  ]);
  return { transactions, investments, debts, notifications };
}

export async function pushNotification(input: AppNotificationInput): Promise<AppNotificationRecord> {
  const db = await getDatabase();
  const now = Date.now();
  const record: AppNotificationRecord = {
    id: newId('ntf'),
    createdAt: now,
    readAt: null,
    kind: input.kind,
    title: input.title.trim().slice(0, 80) || 'Mira',
    body: input.body.trim().slice(0, 200),
    action: input.action ?? null,
    transactionId: input.transactionId ?? null,
    debtId: input.debtId ?? null,
  };
  await db.runAsync(
    `INSERT INTO app_notifications
     (id, created_at, read_at, kind, title, body, action, transaction_id, debt_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.createdAt,
    record.kind,
    record.title,
    record.body,
    record.action,
    record.transactionId,
    record.debtId,
  );
  return record;
}

/**
 * Marks every unread notification as read. Called when the user opens the
 * notification screen so the badge clears on entry rather than requiring a
 * per-item tap.
 */
export async function markAllNotificationsRead(): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    'UPDATE app_notifications SET read_at = ? WHERE read_at IS NULL',
    Date.now(),
  );
  return result.changes;
}

export async function markNotificationRead(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE app_notifications SET read_at = ? WHERE id = ? AND read_at IS NULL',
    Date.now(),
    id,
  );
}

export async function dismissNotification(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM app_notifications WHERE id = ?', id);
}

export async function dismissAllNotifications(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM app_notifications');
}

export async function countUnreadNotifications(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM app_notifications WHERE read_at IS NULL',
  );
  return Number(row?.count ?? 0);
}

export async function getPendingReviewSummary(): Promise<{ count: number; transactionId: string | null }> {
  const db = await getDatabase();
  const [countRow, transactionRow] = await Promise.all([
    db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions WHERE category = 'Needs review'",
    ),
    db.getFirstAsync<{ id: string }>(
      "SELECT id FROM transactions WHERE category = 'Needs review' ORDER BY occurred_at DESC LIMIT 1",
    ),
  ]);
  return {
    count: Number(countRow?.count ?? 0),
    transactionId: transactionRow?.id ?? null,
  };
}

async function insertTransaction(input: TransactionInput, deduplicate: boolean): Promise<boolean> {
  const db = await getDatabase();
  const merchant = input.merchant.trim().slice(0, 120) || 'Unknown merchant';
  const merchantKey = merchant.toLocaleLowerCase('en-IN');
  const source = input.source ?? 'manual';
  const utr = input.utr?.trim().slice(0, 64) || null;
  const emailMessageId = input.emailMessageId?.trim().slice(0, 256) || null;
  const smsFingerprint = input.smsFingerprint?.trim().slice(0, 200) || null;
  // Learned merchant categories apply to any imported source, not just Gmail,
  // so a category the user picked for a merchant also fixes its future SMS.
  const mapping = source === 'manual'
    ? null
    : await db.getFirstAsync<{ category: string }>(
        'SELECT category FROM merchant_mappings WHERE merchant_key = ?',
        merchantKey,
      );
  const category = (mapping?.category ?? input.category).trim().slice(0, 48) || 'Needs review';
  const kind = input.kind;
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) return false;

  if (deduplicate) {
    // Fingerprint first: it is the strongest key for SMS, being either the
    // bank's own reference or day+amount+direction+merchant.
    if (smsFingerprint) {
      const existingFingerprint = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM transactions WHERE sms_fingerprint = ?',
        smsFingerprint,
      );
      if (existingFingerprint) return false;
    }
    if (emailMessageId) {
      const existingMessage = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM transactions WHERE email_message_id = ?',
        emailMessageId,
      );
      if (existingMessage) return false;
    }
    if (utr) {
      const existingUtr = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM transactions WHERE upper(utr) = upper(?)',
        utr,
      );
      if (existingUtr) return false;
    } else if (source === 'gmail') {
      const duplicate = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM transactions
         WHERE source = 'gmail' AND amount_minor = ? AND kind = ?
           AND lower(merchant) = lower(?) AND occurred_at BETWEEN ? AND ?
         LIMIT 1`,
        input.amountMinor,
        kind,
        merchant,
        input.occurredAt - 5 * 60 * 1000,
        input.occurredAt + 5 * 60 * 1000,
      );
      if (duplicate) return false;
    }
  }

  const id = newId('tx');
  let stored = false;
  try {
    await db.withTransactionAsync(async () => {
      const result = await db.runAsync(
        `INSERT INTO transactions
         (id, amount_minor, merchant, category, kind, occurred_at, utr, source,
           email_message_id, sms_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        Math.round(input.amountMinor),
        merchant,
        category,
        kind,
        Math.round(input.occurredAt),
        utr,
        source,
        emailMessageId,
        smsFingerprint,
        Date.now(),
      );

      // "Did not throw" is not the same as "was stored". Reading the row count is
      // what keeps the sync screen honest, because the browser stub accepts the
      // INSERT and changes nothing, and would otherwise report every parsed
      // message as saved. The investment row is skipped for the same reason: it
      // would otherwise point at a transaction that does not exist.
      if (result.changes === 0) return;
      stored = true;

      if (kind === 'investment') {
        await db.runAsync(
          `INSERT INTO investments
           (id, transaction_id, bucket, provider, amount_minor, contributed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId('inv'),
          id,
          input.investmentBucket ?? category,
          input.provider?.trim().slice(0, 100) || null,
          Math.round(input.amountMinor),
          Math.round(input.occurredAt),
        );
      }
    });
  } catch (error) {
    // Two sync passes can both pass the SELECT above and then collide on the
    // unique index. Losing that race means the row already exists, which is the
    // duplicate the caller asked us to drop, not a failure worth surfacing.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return stored;
}

export async function addTransaction(input: TransactionInput): Promise<void> {
  await insertTransaction(input, false);
}

export async function importEmailTransactions(inputs: TransactionInput[]): Promise<number> {
  let inserted = 0;
  for (const input of inputs) {
    if (await insertTransaction({ ...input, source: 'gmail' }, true)) inserted += 1;
  }
  return inserted;
}

/**
 * Persists parsed SMS transactions, silently dropping any whose fingerprint is
 * already stored.
 *
 * Returns both counts because the sync screen has to be able to say "6 added,
 * 4 already tracked" rather than just reporting a delta. Re-running a sync over
 * an unchanged inbox therefore inserts nothing and reports every message as a
 * duplicate, which is the intended behaviour rather than a no-op.
 */
export async function importSmsTransactions(
  inputs: readonly TransactionInput[],
): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  for (const input of inputs) {
    if (await insertTransaction({ ...input, source: 'sms' }, true)) inserted += 1;
  }
  return { inserted, duplicates: inputs.length - inserted };
}

export async function categorizeTransaction(id: string, category: string): Promise<void> {
  const db = await getDatabase();
  const cleanCategory = category.trim().slice(0, 48);
  if (!cleanCategory || cleanCategory === 'Needs review') return;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ merchant: string; kind: TransactionKind }>(
      'SELECT merchant, kind FROM transactions WHERE id = ?',
      id,
    );
    if (!row) return;
    const merchantKey = row.merchant.toLocaleLowerCase('en-IN');
    await db.runAsync(
      `INSERT INTO merchant_mappings(merchant_key, merchant, category, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(merchant_key) DO UPDATE SET merchant = excluded.merchant,
         category = excluded.category, updated_at = excluded.updated_at`,
      merchantKey,
      row.merchant,
      cleanCategory,
      Date.now(),
    );
    await db.runAsync(
      'UPDATE transactions SET category = ? WHERE lower(merchant) = lower(?)',
      cleanCategory,
      row.merchant,
    );
    if (row.kind === 'investment') {
      await db.runAsync(
        'UPDATE investments SET bucket = ? WHERE transaction_id IN (SELECT id FROM transactions WHERE lower(merchant) = lower(?))',
        cleanCategory,
        row.merchant,
      );
    }
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
}

export async function addDebt(input: DebtInput): Promise<DebtRecord> {
  const db = await getDatabase();
  const id = newId('debt');
  await db.runAsync(
    `INSERT INTO debts(id, borrower, phone, principal_minor, repaid_minor,
      interest_rate, given_at, due_at, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'active')`,
    id,
    input.borrower.trim().slice(0, 100),
    input.phone?.trim().slice(0, 30) || null,
    Math.round(input.principalMinor),
    input.interestRate,
    Math.round(input.givenAt),
    Math.round(input.dueAt),
  );
  return {
    id,
    borrower: input.borrower.trim(),
    phone: input.phone?.trim() || null,
    principalMinor: Math.round(input.principalMinor),
    repaidMinor: 0,
    interestRate: input.interestRate,
    givenAt: Math.round(input.givenAt),
    dueAt: Math.round(input.dueAt),
    status: 'active',
    notificationId: null,
  };
}

export async function setDebtNotificationId(id: string, notificationId: string | null): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE debts SET notification_id = ? WHERE id = ?', notificationId, id);
}

export async function recordDebtRepayment(id: string, amountMinor: number): Promise<DebtRecord> {
  const db = await getDatabase();
  let updatedDebt: DebtRecord | null = null;
  await db.withTransactionAsync(async () => {
    const debt = await db.getFirstAsync<DebtRecord>(
      `SELECT id, borrower, phone, principal_minor AS principalMinor,
        repaid_minor AS repaidMinor, interest_rate AS interestRate,
        given_at AS givenAt, due_at AS dueAt, status,
        notification_id AS notificationId FROM debts WHERE id = ?`,
      id,
    );
    if (!debt || debt.status !== 'active') throw new Error('This loan is already settled.');
    const payment = Math.round(amountMinor);
    const outstanding = debt.principalMinor - debt.repaidMinor;
    if (!Number.isFinite(payment) || payment <= 0 || payment > outstanding) {
      throw new Error('Enter a repayment between ₹1 and the outstanding principal.');
    }
    const repaidMinor = debt.repaidMinor + payment;
    const status = repaidMinor >= debt.principalMinor ? 'settled' : 'active';
    const now = Date.now();
    await db.runAsync(
      'UPDATE debts SET repaid_minor = ?, status = ? WHERE id = ?',
      repaidMinor,
      status,
      id,
    );
    await db.runAsync(
      `INSERT INTO transactions
       (id, amount_minor, merchant, category, kind, occurred_at, source, created_at)
       VALUES (?, ?, ?, 'Lending', 'income', ?, 'manual', ?)`,
      newId('tx'),
      payment,
      `Repayment from ${debt.borrower}`.slice(0, 120),
      now,
      now,
    );
    updatedDebt = { ...debt, repaidMinor, status };
  });
  if (!updatedDebt) throw new Error('The repayment could not be saved.');
  return updatedDebt;
}

export async function deleteAllFinanceData(): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM investments');
    await db.runAsync('DELETE FROM transactions');
    await db.runAsync('DELETE FROM merchant_mappings');
    await db.runAsync('DELETE FROM debts');
    await db.runAsync('DELETE FROM app_notifications');
  });
}

/**
 * Replaces all ledger data with the sample dataset from lib/demoData.ts.
 *
 * Intended for previewing screens and animations on an otherwise empty install.
 * It is destructive by design and reachable only from an explicit Settings
 * action, so it can never run implicitly on app start.
 */
export async function seedDemoData(dataset: DemoDataset): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM investments');
    await db.runAsync('DELETE FROM transactions');
    await db.runAsync('DELETE FROM merchant_mappings');
    await db.runAsync('DELETE FROM debts');
    await db.runAsync('DELETE FROM app_notifications');

    for (const demo of dataset.transactions) {
      const transactionId = newId('tx');
      await db.runAsync(
        `INSERT INTO transactions
         (id, amount_minor, merchant, category, kind, occurred_at, utr, source, email_message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
        transactionId,
        Math.round(demo.amountMinor),
        demo.merchant,
        demo.category,
        demo.kind,
        Math.round(demo.occurredAt),
        demo.source,
        Date.now(),
      );
      if (demo.kind === 'investment') {
        await db.runAsync(
          `INSERT INTO investments
           (id, transaction_id, bucket, provider, amount_minor, contributed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId('inv'),
          transactionId,
          demo.investmentBucket ?? demo.category,
          demo.provider ?? null,
          Math.round(demo.amountMinor),
          Math.round(demo.occurredAt),
        );
      }
    }

    for (const demo of dataset.debts) {
      await db.runAsync(
        `INSERT INTO debts(id, borrower, phone, principal_minor, repaid_minor,
          interest_rate, given_at, due_at, status, notification_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        newId('debt'),
        demo.borrower,
        demo.phone,
        Math.round(demo.principalMinor),
        Math.round(demo.repaidMinor),
        demo.interestRate,
        Math.round(demo.givenAt),
        Math.round(demo.dueAt),
        demo.status,
      );
    }

    for (const demo of dataset.notifications) {
      const createdAt = Date.now() - Math.round(demo.hoursAgo * HOUR);
      await db.runAsync(
        `INSERT INTO app_notifications
         (id, created_at, read_at, kind, title, body, action, transaction_id, debt_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        newId('ntf'),
        createdAt,
        demo.read ? createdAt : null,
        demo.kind,
        demo.title,
        demo.body,
        demo.action,
      );
    }
  });
}