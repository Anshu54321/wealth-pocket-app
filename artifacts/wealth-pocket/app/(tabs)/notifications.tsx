import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { router } from 'expo-router';
import { accentGradient, ActionButton, EmptyState, GlossPanel, Page, SectionTitle } from '@/components/finance-ui';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { AppNotificationKind, AppNotificationRecord } from '@/lib/database';
import {
  getSmsPermission,
  isSmsPlatformSupported,
  isSmsSyncEnabled,
  requestSmsPermission,
  setSmsSyncEnabled,
} from '@/lib/sms';

const KIND_ICONS: Record<AppNotificationKind, keyof typeof Feather.glyphMap> = {
  reminder: 'bell',
  review: 'tag',
  lending: 'users',
  sync: 'download',
  system: 'info',
};

/**
 * Each alert kind gets its own accent index, so the feed is scannable by colour
 * alone: loans are green, reviews are violet, reminders amber, syncs pink.
 */
const KIND_ACCENT_INDEX: Record<AppNotificationKind, number> = {
  reminder: 4,
  review: 1,
  lending: 0,
  sync: 2,
  system: 5,
};

const KIND_LABELS: Record<AppNotificationKind, string> = {
  reminder: 'Reminder',
  review: 'Needs review',
  lending: 'Lending',
  sync: 'Sync',
  system: 'System',
};

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}

/**
 * Resolves the stored action to a route.
 *
 * Legacy actions are plain verbs ('open-lending'); newer ones are already
 * routes. Recognising both means existing rows keep working after the format
 * changed rather than silently becoming inert.
 */
function destinationFor(notification: AppNotificationRecord): string | null {
  if (notification.action === 'review-transactions') return '/(tabs)/insights';
  if (notification.action === 'open-lending') return '/(tabs)/lending';
  if (notification.action?.startsWith('/(tabs)/')) return notification.action;
  return null;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const {
    notifications,
    unreadNotificationCount,
    markAllNotificationsRead,
    dismissNotification,
    dismissAllNotifications,
    syncSmsTransactions,
  } = useFinance();
  // Opening the screen is the read receipt. Guarded by a ref so re-renders and
  // focus changes do not fire a redundant write.
  const markedOnOpen = useRef(false);
  const [smsSyncEnabled, setSmsSyncEnabledState] = useState(false);
  const [smsSyncing, setSmsSyncing] = useState(false);

  useEffect(() => {
    let mounted = true;
    void isSmsSyncEnabled()
      .catch(() => false)
      .then((enabled) => {
        if (mounted) setSmsSyncEnabledState(enabled);
      });
    return () => { mounted = false; };
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
    } catch (error) {
      Alert.alert(
        'Could not update notifications',
        error instanceof Error ? error.message : 'Try again.',
      );
    }
  }, [markAllNotificationsRead]);

  useEffect(() => {
    if (markedOnOpen.current) return;
    if (unreadNotificationCount === 0) return;
    markedOnOpen.current = true;
    void markAllRead();
  }, [markAllRead, unreadNotificationCount]);

  const grouped = useMemo(() => {
    const today: AppNotificationRecord[] = [];
    const earlier: AppNotificationRecord[] = [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    for (const item of notifications) {
      (item.createdAt >= startOfToday.getTime() ? today : earlier).push(item);
    }
    return { today, earlier };
  }, [notifications]);

  const confirmClearAll = () => {
    Alert.alert('Clear all notifications?', 'This removes every alert from this device.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => void dismissAllNotifications() },
    ]);
  };

  /**
   * The sync button is the only place the inbox is ever read, so it also owns
   * the permission handshake. Settings can be pre-toggled, but a user who
   * enables SMS here without visiting Settings should not be told to go
   * somewhere else: the prompt is requested inline, and opting in from here
   * writes the same preference the Settings toggle reads.
   */
  const runSmsSync = async () => {
    if (!isSmsPlatformSupported()) {
      Alert.alert('Android only', 'Reading bank messages to log transactions works on Android devices.');
      return;
    }

    let permission = await getSmsPermission().catch(() => 'unavailable' as const);
    if (permission !== 'granted') {
      if (!smsSyncEnabled) {
        Alert.alert(
          'Allow message access?',
          'Mira needs to read your recent messages to log bank transactions automatically. Messages are parsed on this device and never uploaded.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Allow', onPress: () => void (async () => {
              const next = await requestSmsPermission();
              setSmsSyncEnabledState(next === 'granted');
              if (next === 'granted') await setSmsSyncEnabled(true);
            })() },
          ],
        );
        return;
      }
      permission = await requestSmsPermission();
    }
    if (permission !== 'granted') {
      Alert.alert(
        permission === 'blocked' ? 'Permission blocked' : 'Message access needed',
        permission === 'blocked'
          ? 'Android is no longer asking. Open Mira\'s app settings and allow message access, then try again.'
          : 'Mira cannot read bank messages without this permission. Turn on "Allow SMS Sync for Auto-Tracking" in Settings.',
      );
      return;
    }

    setSmsSyncing(true);
    try {
      const result = await syncSmsTransactions();
      const previewNote = result.usedPreview ? ' Preview messages, not your real inbox.' : '';
      if (result.parsed.length === 0) {
        Alert.alert(
          'No transactions found',
          result.scanned === 0
            ? `No messages were available to read.${previewNote}`
            : `${result.scanned} message${result.scanned === 1 ? '' : 's'} read, but none looked like a bank transaction. ${result.skipped} from non-bank senders were ignored.${previewNote}`,
        );
        return;
      }
      Alert.alert(
        result.inserted === 0 ? 'Nothing new to add' : 'Sync complete',
        result.inserted === 0
          ? `All ${result.parsed.length} transaction${result.parsed.length === 1 ? '' : 's'} are already in your ledger.`
          : `${result.inserted} added, ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.`,
      );
    } catch (error) {
      Alert.alert(
        'Could not sync messages',
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    } finally {
      setSmsSyncing(false);
    }
  };

  const renderItem = (item: AppNotificationRecord) => {
    const accentIndex = KIND_ACCENT_INDEX[item.kind];
    const gradient = accentGradient(colors, accentIndex);
    const tint = colors.chartColors[accentIndex];
    const unread = item.readAt === null;
    return (
      <Animated.View
        key={item.id}
        entering={FadeInDown.duration(340)}
        layout={LinearTransition.duration(220)}
      >
        <GlossPanel intensity="solid" style={[styles.item, unread && styles.itemUnread]}>
          {/* Colour rail: the fastest way to scan kind without reading icons. */}
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.itemRail}
          />
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.itemIcon}
          >
            <Feather name={KIND_ICONS[item.kind]} size={16} color="#FFFFFF" />
          </LinearGradient>
          <Pressable
            style={styles.itemBody}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.body}`}
            onPress={() => {
              const destination = destinationFor(item);
              if (destination) router.push(destination as never);
            }}
          >
            <View style={styles.itemTitleRow}>
              <View style={[styles.kindBadge, { backgroundColor: `${tint}1A` }]}>
                <Text style={[styles.kindBadgeText, { color: tint }]}>{KIND_LABELS[item.kind]}</Text>
              </View>
              {unread ? <View style={[styles.unreadDot, { backgroundColor: tint }]} /> : null}
            </View>
            <Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.itemBodyText, { color: colors.mutedForeground }]}>{item.body}</Text>
            <Text style={[styles.itemTime, { color: colors.mutedForeground }]}>{relativeTime(item.createdAt)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${item.title}`}
            testID={`dismiss-notification-${item.id}`}
            hitSlop={8}
            onPress={() => void dismissNotification(item.id)}
            style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </Pressable>
        </GlossPanel>
      </Animated.View>
    );
  };

  return (
    <Page
      title="Notifications"
      subtitle="Alerts from your local ledger"
      right={
        notifications.length > 0 ? (
          <Pressable accessibilityRole="button" testID="clear-notifications" onPress={confirmClearAll}>
            <Text style={[styles.clearAll, { color: colors.primary }]}>Clear</Text>
          </Pressable>
        ) : undefined
      }
    >
      <SectionTitle title="Sync" />
      <GlossPanel style={styles.syncPanel}>
        <View style={styles.syncHeader}>
          <LinearGradient
            colors={colors.glossStrong}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.syncIcon}
          >
            <Feather name="message-square" size={17} color={colors.primaryForeground} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: colors.foreground }]}>Bank message capture</Text>
            <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
              {smsSyncEnabled
                ? 'Reads your last 30 messages, then adds only the ones that are new.'
                : 'Reads your last 30 messages, then adds only the ones that are new. Android will ask for message access.'}
            </Text>
          </View>
        </View>
        <ActionButton
          title="Sync Recent Transactions"
          icon="refresh-cw"
          onPress={() => void runSmsSync()}
          loading={smsSyncing}
          testID="sync-sms"
        />
        <View style={styles.scopeRow}>
          <Feather name="shield" size={13} color={colors.primary} />
          <Text style={[styles.scopeText, { color: colors.mutedForeground }]}>
            Runs only when you tap · Repeats are skipped automatically
          </Text>
        </View>
      </GlossPanel>

      {unreadNotificationCount > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <GlossPanel style={styles.banner}>
            <LinearGradient
              colors={colors.glossStrong}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.bannerIcon}
            >
              <Feather name="bell" size={17} color={colors.primaryForeground} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
                {unreadNotificationCount} unread
              </Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                Marked as read as soon as you open this screen.
              </Text>
            </View>
          </GlossPanel>
        </Animated.View>
      ) : null}

      {notifications.length === 0 ? (
        <GlossPanel>
          <EmptyState
            icon="bell"
            title="Nothing to catch up on"
            message="Loan reminders, SMS captures, and items needing a category will appear here."
          />
        </GlossPanel>
      ) : (
        <>
          {grouped.today.length > 0 ? (
            <>
              <SectionTitle title="Today" />
              {grouped.today.map(renderItem)}
            </>
          ) : null}
          {grouped.earlier.length > 0 ? (
            <>
              <SectionTitle title="Earlier" />
              {grouped.earlier.map(renderItem)}
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  syncPanel: { gap: 12, marginBottom: 14 },
  syncHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  syncIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  scopeText: { fontSize: 9, flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 14, fontWeight: '700' },
  bannerBody: { fontSize: 11, marginTop: 3 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14, marginBottom: 9 },
  itemUnread: { borderWidth: 1.5 },
  itemRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  itemIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1, gap: 4 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  kindBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  kindBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  itemTitle: { fontSize: 13, fontWeight: '700' },
  itemBodyText: { fontSize: 11, lineHeight: 16 },
  itemTime: { fontSize: 10 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  dismiss: { padding: 2 },
  clearAll: { fontSize: 12, fontWeight: '700' },
});