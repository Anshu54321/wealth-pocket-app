import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { DebtRecord } from './database';

const REMINDERS_ENABLED = 'mira.reminders.enabled.v1';
export const TRANSACTION_REVIEW_CATEGORY = 'MIRA_TRANSACTION_REVIEW';
export const REVIEW_ACTION_CATEGORIES: Record<string, string> = {
  'category-food': 'Food & dining',
  'category-transport': 'Transport',
  'category-groceries': 'Groceries',
};

export async function registerFinanceNotificationActions(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.setNotificationCategoryAsync(TRANSACTION_REVIEW_CATEGORY, [
    {
      identifier: 'category-food',
      buttonTitle: 'Food',
      options: { opensAppToForeground: true, isAuthenticationRequired: true },
    },
    {
      identifier: 'category-transport',
      buttonTitle: 'Transport',
      options: { opensAppToForeground: true, isAuthenticationRequired: true },
    },
    {
      identifier: 'category-groceries',
      buttonTitle: 'Groceries',
      options: { opensAppToForeground: true, isAuthenticationRequired: true },
    },
  ]);
}

export async function getReminderPermission(): Promise<boolean> {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.granted;
}

export async function getReminderPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(REMINDERS_ENABLED)) === 'true';
}

export async function setReminderPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(REMINDERS_ENABLED, String(enabled));
  if (!enabled) await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function requestReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  if (!requested.granted) return false;

  if (process.env.EXPO_OS === 'android') {
    await Notifications.setNotificationChannelAsync('finance-reminders', {
      name: 'Finance reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#3AD5C6',
    });
  }
  return true;
}

export async function scheduleDebtReminder(debt: DebtRecord): Promise<string | null> {
  if (debt.status !== 'active' || debt.dueAt < Date.now()) return null;
  if (!(await getReminderPreference())) return null;
  if (!(await getReminderPermission())) return null;
  const due = new Date(debt.dueAt);
  due.setHours(9, 0, 0, 0);
  if (due.getTime() <= Date.now()) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Mira reminder',
      body: 'A repayment reminder is due today. Open your Lending book to follow up.',
      data: { debtId: debt.id, action: 'due' },
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: due,
      channelId: 'finance-reminders',
    },
  });
}

export async function cancelReminder(identifier: string | null): Promise<void> {
  if (identifier) await Notifications.cancelScheduledNotificationAsync(identifier);
}

export async function clearFinanceNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}

export async function notifyPendingCategories(count: number, transactionId: string | null): Promise<void> {
  if (count <= 0 || !transactionId || !(await getReminderPreference()) || !(await getReminderPermission())) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Mira needs a quick review',
      body: `${count} imported transaction${count === 1 ? '' : 's'} still need a category.`,
      categoryIdentifier: TRANSACTION_REVIEW_CATEGORY,
      data: { action: 'review-transactions', transactionId },
      sound: false,
    },
    trigger: null,
  });
}