import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Page, Panel, SectionTitle, TransactionRow, money, ActionButton, IconButton, EmptyState } from '@/components/finance-ui';
import { CategoryReviewSheet, QuickAddSheet } from '@/components/QuickSheets';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { TransactionKind } from '@/lib/database';

export default function HomeScreen() {
  const colors = useColors();
  const { transactions, investments, debts, isReady, error, refresh, addTransaction, categorizeTransaction } = useFinance();
  const [showAdd, setShowAdd] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const now = new Date();
  const monthTransactions = useMemo(() => transactions.filter((item) => {
    const occurred = new Date(item.occurredAt);
    return occurred.getMonth() === now.getMonth() && occurred.getFullYear() === now.getFullYear();
  }), [transactions, now.getMonth(), now.getFullYear()]);
  const sumKind = (kind: TransactionKind) => monthTransactions
    .filter((item) => item.kind === kind)
    .reduce((total, item) => total + item.amountMinor, 0);
  const income = sumKind('income');
  const expenses = sumKind('expense');
  const invested = investments.reduce((total, item) => total + item.amountMinor, 0);
  const lent = debts.filter((debt) => debt.status === 'active')
    .reduce((total, debt) => total + debt.principalMinor - debt.repaidMinor, 0);
  const liquid = income - expenses - sumKind('investment') - lent;
  const pending = transactions.filter((item) => item.category === 'Needs review');
  const recent = transactions.slice(0, 5);
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Page
      title="Mira"
      subtitle={`${greeting} · your money, in view`}
      right={<IconButton icon="settings" onPress={() => router.push('/(tabs)/settings')} accessibilityLabel="Settings" />}
    >
      <Animated.View entering={FadeInDown.duration(500).springify()}>
        <LinearGradient
          colors={[colors.subtleGreen, colors.card, colors.card]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.balanceCard, { borderColor: colors.border }]}
        >
          <View style={styles.balanceTop}>
            <View>
              <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>MONTHLY CASH FLOW</Text>
              <Text style={[styles.balanceCaption, { color: colors.mutedForeground }]}>After spending, investing & lending</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={hideBalance ? 'Show amounts' : 'Hide amounts'} onPress={() => setHideBalance((value) => !value)}>
              <Feather name={hideBalance ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.balanceAmount, { color: colors.foreground }]}>
            {hideBalance ? '₹ ••••••' : money(liquid)}
          </Text>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceMetrics}>
            <View style={styles.balanceMetric}>
              <View style={[styles.metricDot, { backgroundColor: colors.positive }]} />
              <View>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Money in</Text>
                <Text style={[styles.metricValue, { color: colors.foreground }]}>{hideBalance ? '••••' : money(income, true)}</Text>
              </View>
            </View>
            <View style={styles.balanceMetric}>
              <View style={[styles.metricDot, { backgroundColor: colors.accent }]} />
              <View>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Money out</Text>
                <Text style={[styles.metricValue, { color: colors.foreground }]}>{hideBalance ? '••••' : money(expenses, true)}</Text>
              </View>
            </View>
          </View>
          <View style={[styles.balanceBloom, { borderColor: colors.accent }]} />
          <View style={[styles.balanceBloomSmall, { borderColor: colors.primary }]} />
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(450)}>
        <View style={styles.quickActions}>
          <Pressable
            testID="quick-add-expense"
            accessibilityRole="button"
            onPress={() => setShowAdd(true)}
            style={({ pressed }) => [styles.quickAction, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
            <Text style={[styles.quickActionText, { color: colors.primaryForeground }]}>Add entry</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/insights')}
            style={({ pressed }) => [styles.shortcut, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="pie-chart" size={17} color={colors.accent} />
            <Text style={[styles.shortcutText, { color: colors.foreground }]}>Portfolio</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/calendar')}
            style={({ pressed }) => [styles.shortcut, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="calendar" size={17} color={colors.accent} />
            <Text style={[styles.shortcutText, { color: colors.foreground }]}>Calendar</Text>
          </Pressable>
        </View>
      </Animated.View>

      {pending.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(150).duration(450)}>
          <Pressable
            accessibilityRole="button"
            testID="open-category-review"
            onPress={() => setShowReview(true)}
            style={({ pressed }) => [styles.reviewBanner, { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={[styles.reviewIcon, { backgroundColor: colors.subtleGreen }]}>
              <Feather name="tag" color={colors.primary} size={17} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.reviewTitle, { color: colors.foreground }]}>{pending.length} to categorize</Text>
              <Text style={[styles.reviewSub, { color: colors.mutedForeground }]}>Your choices teach Mira what to use next time.</Text>
            </View>
            <Feather name="chevron-right" color={colors.mutedForeground} size={19} />
          </Pressable>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.delay(200).duration(450)}>
        <SectionTitle title="Your wealth" trailing={
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/insights')}>
            <Text style={[styles.link, { color: colors.primary }]}>See insights</Text>
          </Pressable>
        } />
        <View style={styles.wealthRow}>
          <Panel style={styles.wealthCard}>
            <View style={[styles.wealthIcon, { backgroundColor: colors.subtleGreen }]}>
              <Feather name="trending-up" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.wealthValue, { color: colors.foreground }]}>{money(invested, true)}</Text>
            <Text style={[styles.wealthLabel, { color: colors.mutedForeground }]}>Invested</Text>
          </Panel>
          <Panel style={styles.wealthCard}>
            <View style={[styles.wealthIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="book-open" size={17} color={colors.accent} />
            </View>
            <Text style={[styles.wealthValue, { color: colors.foreground }]}>{money(lent, true)}</Text>
            <Text style={[styles.wealthLabel, { color: colors.mutedForeground }]}>Out on loan</Text>
          </Panel>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(260).duration(450)}>
        <SectionTitle title="Recent activity" trailing={
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/calendar')}>
            <Text style={[styles.link, { color: colors.primary }]}>View all</Text>
          </Pressable>
        } />
        <Panel style={styles.recentPanel}>
          {error ? (
            <View style={styles.errorState}>
              <Text style={[styles.reviewTitle, { color: colors.destructive }]}>Local ledger unavailable</Text>
              <Text style={[styles.reviewSub, { color: colors.mutedForeground }]}>{error}</Text>
              <ActionButton title="Try again" icon="refresh-cw" onPress={() => void refresh()} secondary />
            </View>
          ) : !isReady ? (
            <View style={styles.loadingRow}><Feather name="loader" size={17} color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground }}>Opening your encrypted ledger…</Text></View>
          ) : recent.length === 0 ? (
            <EmptyState
              icon="activity"
              title="Your ledger starts here"
              message="Add your first entry or connect Gmail to bring in recent bank alerts."
              action={<ActionButton title="Add a transaction" icon="plus" onPress={() => setShowAdd(true)} />}
            />
          ) : recent.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </Panel>
      </Animated.View>

      <QuickAddSheet visible={showAdd} onClose={() => setShowAdd(false)} onSave={addTransaction} />
      <CategoryReviewSheet
        visible={showReview}
        transactions={pending}
        onClose={() => setShowReview(false)}
        onCategorize={categorizeTransaction}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  balanceCard: { borderWidth: 1, overflow: 'hidden', borderRadius: 30, minHeight: 224, padding: 22, marginBottom: 14 },
  balanceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4 },
  balanceCaption: { fontSize: 11, marginTop: 5 },
  balanceAmount: { fontSize: 38, fontWeight: '700', letterSpacing: -1.5, marginTop: 16, marginBottom: 20 },
  balanceDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(220,240,220,0.18)', marginBottom: 15 },
  balanceMetrics: { flexDirection: 'row', gap: 32 },
  balanceMetric: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricDot: { width: 7, height: 7, borderRadius: 4 },
  metricLabel: { fontSize: 10 },
  metricValue: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  balanceBloom: { position: 'absolute', width: 140, height: 140, borderRadius: 70, borderWidth: 1, opacity: 0.13, right: -48, top: 38 },
  balanceBloomSmall: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1, opacity: 0.18, right: -20, top: 63 },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 12 },
  quickAction: { flex: 1.12, minHeight: 52, paddingHorizontal: 13, borderRadius: 17, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  quickActionText: { fontSize: 12, fontWeight: '700' },
  shortcut: { flex: 1, minHeight: 52, borderRadius: 17, borderWidth: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 },
  shortcutText: { fontSize: 10, fontWeight: '600' },
  reviewBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 19, borderWidth: 1, marginBottom: 4 },
  reviewIcon: { width: 36, height: 36, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  reviewTitle: { fontSize: 13, fontWeight: '700' },
  reviewSub: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  wealthRow: { flexDirection: 'row', gap: 10 },
  wealthCard: { flex: 1, marginBottom: 0, padding: 14 },
  wealthIcon: { width: 33, height: 33, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  wealthValue: { fontSize: 19, fontWeight: '700', letterSpacing: -0.5 },
  wealthLabel: { fontSize: 11, marginTop: 4 },
  link: { fontSize: 11, fontWeight: '700' },
  recentPanel: { paddingHorizontal: 14, paddingVertical: 6 },
  errorState: { alignItems: 'flex-start', padding: 13, gap: 8 },
  loadingRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});