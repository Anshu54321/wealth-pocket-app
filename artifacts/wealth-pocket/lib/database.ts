import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getOrCreateDatabaseKey } from './security';

export type TransactionKind = 'expense' | 'income' | 'investment';
export type TransactionSource = 'manual' | 'gmail';

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
}

export interface InvestmentRecord {
  id: string;
  transactionId: string;
  bucket: string;
  provider: string | null;
  amountMinor: number;
  contributedAt: number;
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
}

let database: SQLiteDatabase | null = null;
let opening: Promise<SQLiteDatabase> | null = null;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getDatabase(): Promise<SQLiteDatabase> {
  if (database) return database;
  if (opening) return opening;

  opening = (async () => {
    const db = await SQLite.openDatabaseAsync('mira-finance.db');
    const key = await getOrCreateDatabaseKey();
    await db.execAsync(`PRAGMA key = '${key}';`);
    await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = Number(versionRow?.user_version ?? 0);
    if (currentVersion > 1) {
      throw new Error('This Mira database was created by a newer app version. Update Mira before opening it.');
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
        source TEXT NOT NULL CHECK (source IN ('manual', 'gmail')),
        email_message_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_utr_unique
        ON transactions(upper(utr)) WHERE utr IS NOT NULL AND trim(utr) <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS transactions_email_message_unique
        ON transactions(email_message_id) WHERE email_message_id IS NOT NULL;
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
      INSERT OR IGNORE INTO schema_meta(id, version) VALUES (1, 1);
    `);
    if (currentVersion < 1) await db.execAsync('PRAGMA user_version = 1;');
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
  const [transactions, investments, debts] = await Promise.all([
    db.getAllAsync<TransactionRecord>(
      `SELECT id, amount_minor AS amountMinor, merchant, category, kind,
        occurred_at AS occurredAt, utr, source,
        email_message_id AS emailMessageId
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
  ]);
  return { transactions, investments, debts };
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
  const mapping = source === 'gmail'
    ? await db.getFirstAsync<{ category: string }>(
        'SELECT category FROM merchant_mappings WHERE merchant_key = ?',
        merchantKey,
      )
    : null;
  const category = (mapping?.category ?? input.category).trim().slice(0, 48) || 'Needs review';
  const kind = input.kind;
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) return false;

  if (deduplicate) {
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
    } else {
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
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO transactions
       (id, amount_minor, merchant, category, kind, occurred_at, utr, source, email_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      Math.round(input.amountMinor),
      merchant,
      category,
      kind,
      Math.round(input.occurredAt),
      utr,
      source,
      emailMessageId,
      Date.now(),
    );
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
  return true;
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
  });
}