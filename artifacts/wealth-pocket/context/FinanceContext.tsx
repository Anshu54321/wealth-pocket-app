import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addDebt as addDebtToDb,
  addTransaction as addTransactionToDb,
  categorizeTransaction as categorizeInDb,
  countUnreadNotifications,
  deleteAllFinanceData as deleteAllFromDb,
  deleteTransaction as deleteFromDb,
  // Aliased on purpose: the context exposes callbacks with these same names, and
  // an unaliased import would be shadowed by the local binding, making each
  // callback recursively call itself instead of the database helper.
  dismissAllNotifications as dismissAllFromDb,
  dismissNotification as dismissFromDb,
  getFinanceSnapshot,
  getPendingReviewSummary,
  importEmailTransactions,
  importSmsTransactions,
  initializeDatabase,
  markAllNotificationsRead as markAllReadInDb,
  markNotificationRead as markReadInDb,
  pushNotification,
  recordDebtRepayment as repayInDb,
  seedDemoData as seedDemoInDb,
  setDebtNotificationId,
  type AppNotificationInput,
  type DebtInput,
  type DebtRecord,
  type FinanceSnapshot,
  type TransactionInput,
} from '@/lib/database';
import { buildDemoDataset } from '@/lib/demoData';
import { cancelReminder, clearFinanceNotifications, scheduleDebtReminder } from '@/lib/notifications';
import { collectRecentSmsTransactions, type SmsSyncResult } from '@/lib/sms';

interface FinanceContextValue extends FinanceSnapshot {
  isReady: boolean;
  error: string | null;
  unreadNotificationCount: number;
  refresh: () => Promise<void>;
  addTransaction: (input: TransactionInput) => Promise<void>;
  importTransactions: (input: TransactionInput[]) => Promise<{ inserted: number; pending: number }>;
  /** Reads recent bank messages, stores new ones, drops repeats. Manual only. */
  syncSmsTransactions: () => Promise<SmsSyncResult>;
  categorizeTransaction: (id: string, category: string) => Promise<void>;
  addDebt: (input: DebtInput) => Promise<DebtRecord>;
  scheduleActiveDebtReminders: () => Promise<void>;
  recordRepayment: (id: string, amountMinor: number) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  deleteAllData: () => Promise<void>;
  notify: (input: AppNotificationInput) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
  /** Replaces the ledger with the sample dataset. Destructive; explicit only. */
  loadDemoData: () => Promise<void>;
  isDemoData: boolean;
}

const emptySnapshot: FinanceSnapshot = { transactions: [], investments: [], debts: [], notifications: [] };
const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(emptySnapshot);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  // In-memory only. It drives the "sample data" banner so the UI never implies
  // the seeded rows are real; a reload drops the flag, which is the safe
  // direction to be wrong in.
  const [isDemo, setIsDemo] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [data, unread] = await Promise.all([getFinanceSnapshot(), countUnreadNotifications()]);
      setSnapshot(data);
      setUnreadCount(unread);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your local finance data could not be opened.');
      throw caught;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeDatabase();
        const [data, unread] = await Promise.all([getFinanceSnapshot(), countUnreadNotifications()]);
        if (active) {
          setSnapshot(data);
          setUnreadCount(unread);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Database setup failed.');
      } finally {
        if (active) setIsReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addTransaction = useCallback(async (input: TransactionInput) => {
    await addTransactionToDb(input);
    await refresh();
  }, [refresh]);

  const importTransactions = useCallback(async (input: TransactionInput[]) => {
    const inserted = await importEmailTransactions(input);
    if (inserted > 0) {
      const summary = await getPendingReviewSummary().catch(() => ({ count: 0, transactionId: null }));
      await pushNotification({
        kind: summary.count > 0 ? 'review' : 'sync',
        title: summary.count > 0 ? 'Transactions need categories' : 'Gmail sync complete',
        body: summary.count > 0
          ? `${inserted} new entr${inserted === 1 ? 'y' : 'ies'} imported. ${summary.count} still need a category.`
          : `${inserted} new entr${inserted === 1 ? 'y' : 'ies'} imported from Gmail.`,
        action: summary.count > 0 ? 'review-transactions' : null,
        transactionId: summary.transactionId,
      }).catch(() => undefined);
    }
    await refresh();
    return {
      inserted,
      pending: input.filter((transaction) => transaction.category === 'Needs review').length,
    };
  }, [refresh]);

  /**
   * One SMS sync pass: read recent messages, parse them, store what is new.
   *
   * Nothing runs on a background schedule. Reading the inbox is a privacy
   * decision the user makes per tap, and a background reader would keep the SMS
   * permission active between sessions.
   */
  const syncSmsTransactions = useCallback(async (): Promise<SmsSyncResult> => {
    const collected = await collectRecentSmsTransactions();
    const { inserted, duplicates } = await importSmsTransactions(collected.parsed);
    if (inserted > 0) {
      const summary = await getPendingReviewSummary().catch(() => ({ count: 0, transactionId: null }));
      await pushNotification({
        kind: summary.count > 0 ? 'review' : 'sync',
        title: summary.count > 0 ? 'SMS entries need categories' : 'SMS sync complete',
        body: summary.count > 0
          ? `${inserted} new entr${inserted === 1 ? 'y' : 'ies'} captured. ${summary.count} still need a category.`
          : `${inserted} new entr${inserted === 1 ? 'y' : 'ies'} captured from bank messages.`,
        action: summary.count > 0 ? 'review-transactions' : null,
        transactionId: summary.transactionId,
      }).catch(() => undefined);
    }
    await refresh();
    return { ...collected, inserted, duplicates };
  }, [refresh]);

  const categorizeTransaction = useCallback(async (id: string, category: string) => {
    await categorizeInDb(id, category);
    await refresh();
  }, [refresh]);

  const addDebt = useCallback(async (input: DebtInput) => {
    const debt = await addDebtToDb(input);
    try {
      const notificationId = await scheduleDebtReminder(debt);
      if (notificationId) {
        await setDebtNotificationId(debt.id, notificationId);
        debt.notificationId = notificationId;
      }
      await pushNotification({
        kind: 'lending',
        title: 'Loan recorded',
        body: `You lent ${debt.borrower} money, due ${new Date(debt.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`,
        action: 'open-lending',
        debtId: debt.id,
      }).catch(() => undefined);
    } finally {
      await refresh();
    }
    return debt;
  }, [refresh]);

  const scheduleActiveDebtReminders = useCallback(async () => {
    for (const debt of snapshot.debts) {
      if (debt.status !== 'active') continue;
      if (debt.notificationId) await cancelReminder(debt.notificationId);
      const notificationId = await scheduleDebtReminder({ ...debt, notificationId: null });
      await setDebtNotificationId(debt.id, notificationId);
    }
    await refresh();
  }, [refresh, snapshot.debts]);

  const recordRepayment = useCallback(async (id: string, amountMinor: number) => {
    const debt = await repayInDb(id, amountMinor);
    if (debt.status === 'settled') await cancelReminder(debt.notificationId);
    // A failed in-app notification must not roll back a repayment that is
    // already committed, so this write is allowed to fail silently.
    await pushNotification({
      kind: 'lending',
      title: debt.status === 'settled' ? 'Loan settled' : 'Repayment recorded',
      body: debt.status === 'settled'
        ? `${debt.borrower} has repaid the full amount.`
        : `${debt.borrower} repaid part of the loan.`,
      action: 'open-lending',
      debtId: debt.id,
    }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  const deleteTransaction = useCallback(async (id: string) => {
    await deleteFromDb(id);
    await refresh();
  }, [refresh]);

  const notify = useCallback(async (input: AppNotificationInput) => {
    await pushNotification(input);
    await refresh();
  }, [refresh]);

  const markAllNotificationsRead = useCallback(async () => {
    // Apply locally first so the badge clears immediately on entry rather than
    // after a round trip; refresh() then reconciles against the database.
    setSnapshot((current) => ({
      ...current,
      notifications: current.notifications.map((item) =>
        item.readAt === null ? { ...item, readAt: Date.now() } : item,
      ),
    }));
    setUnreadCount(0);
    await markAllReadInDb();
    await refresh();
  }, [refresh]);

  const markNotificationRead = useCallback(async (id: string) => {
    await markReadInDb(id);
    await refresh();
  }, [refresh]);

  const dismissNotification = useCallback(async (id: string) => {
    await dismissFromDb(id);
    await refresh();
  }, [refresh]);

  const dismissAllNotifications = useCallback(async () => {
    await dismissAllFromDb();
    await refresh();
  }, [refresh]);

  const loadDemoData = useCallback(async () => {
    await clearFinanceNotifications();
    await seedDemoInDb(buildDemoDataset());
    await refresh();
    setIsDemo(true);
  }, [refresh]);

  const deleteAllData = useCallback(async () => {
    await clearFinanceNotifications();
    await deleteAllFromDb();
    await refresh();
    setIsDemo(false);
  }, [refresh]);

  const value = useMemo<FinanceContextValue>(() => ({
    ...snapshot,
    isReady,
    error,
    unreadNotificationCount: unreadCount,
    refresh,
    addTransaction,
    importTransactions,
    syncSmsTransactions,
    categorizeTransaction,
    addDebt,
    scheduleActiveDebtReminders,
    recordRepayment,
    deleteTransaction,
    deleteAllData,
    notify,
    markAllNotificationsRead,
    markNotificationRead,
    dismissNotification,
    dismissAllNotifications,
    loadDemoData,
    isDemoData: isDemo,
  }), [
    snapshot,
    isReady,
    error,
    unreadCount,
    isDemo,
    refresh,
    addTransaction,
    importTransactions,
    syncSmsTransactions,
    categorizeTransaction,
    addDebt,
    scheduleActiveDebtReminders,
    recordRepayment,
    deleteTransaction,
    deleteAllData,
    notify,
    markAllNotificationsRead,
    markNotificationRead,
    dismissNotification,
    dismissAllNotifications,
  ]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used inside FinanceProvider.');
  return context;
}