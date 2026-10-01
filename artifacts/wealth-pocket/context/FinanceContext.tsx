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
  deleteAllFinanceData as deleteAllFromDb,
  deleteTransaction as deleteFromDb,
  getFinanceSnapshot,
  importEmailTransactions,
  initializeDatabase,
  recordDebtRepayment as repayInDb,
  setDebtNotificationId,
  type DebtInput,
  type DebtRecord,
  type FinanceSnapshot,
  type TransactionInput,
} from '@/lib/database';
import { cancelReminder, clearFinanceNotifications, scheduleDebtReminder } from '@/lib/notifications';

interface FinanceContextValue extends FinanceSnapshot {
  isReady: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addTransaction: (input: TransactionInput) => Promise<void>;
  importTransactions: (input: TransactionInput[]) => Promise<{ inserted: number; pending: number }>;
  categorizeTransaction: (id: string, category: string) => Promise<void>;
  addDebt: (input: DebtInput) => Promise<DebtRecord>;
  scheduleActiveDebtReminders: () => Promise<void>;
  recordRepayment: (id: string, amountMinor: number) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  deleteAllData: () => Promise<void>;
}

const emptySnapshot: FinanceSnapshot = { transactions: [], investments: [], debts: [] };
const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(emptySnapshot);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getFinanceSnapshot();
      setSnapshot(data);
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
        const data = await getFinanceSnapshot();
        if (active) setSnapshot(data);
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
    await refresh();
    return {
      inserted,
      pending: input.filter((transaction) => transaction.category === 'Needs review').length,
    };
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
    await refresh();
  }, [refresh]);

  const deleteTransaction = useCallback(async (id: string) => {
    await deleteFromDb(id);
    await refresh();
  }, [refresh]);

  const deleteAllData = useCallback(async () => {
    await clearFinanceNotifications();
    await deleteAllFromDb();
    await refresh();
  }, [refresh]);

  const value = useMemo<FinanceContextValue>(() => ({
    ...snapshot,
    isReady,
    error,
    refresh,
    addTransaction,
    importTransactions,
    categorizeTransaction,
    addDebt,
    scheduleActiveDebtReminders,
    recordRepayment,
    deleteTransaction,
    deleteAllData,
  }), [
    snapshot,
    isReady,
    error,
    refresh,
    addTransaction,
    importTransactions,
    categorizeTransaction,
    addDebt,
    scheduleActiveDebtReminders,
    recordRepayment,
    deleteTransaction,
    deleteAllData,
  ]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used inside FinanceProvider.');
  return context;
}