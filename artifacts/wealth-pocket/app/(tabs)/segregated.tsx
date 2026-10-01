import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { router } from 'expo-router';
import { ActionButton, accentGradient, EmptyState, GlossPanel, Page, SectionTitle, TransactionRow, categoryIcon, money } from '@/components/finance-ui';
import { QuickAddSheet } from '@/components/QuickSheets';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { TransactionInput, TransactionKind, TransactionRecord } from '@/lib/database';

type SegmentedView = 'income' | 'expense' | 'savings';

interface SegmentedTab {
  key: SegmentedView;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  kind: TransactionKind;
  /** Index into `accentGradients`, so each view has its own vivid identity. */
  accentIndex: number;
  blurb: string;
}

/**
 * The three-way split requested for segregation. `savings` is not a stored
 * transaction kind: it is derived from `investment` contributions minus active
 * loans, so it maps to `investment` rows while displaying the net position.
 */
const TABS: readonly SegmentedTab[] = [
  { key: 'income', label: 'Income', icon: 'arrow-down-left', kind: 'income', accentIndex: 0, blurb: 'Money received' },
  { key: 'expense', label: 'Expenses', icon: 'arrow-up-right', kind: 'expense', accentIndex: 2, blurb: 'Money spent' },
  { key: 'savings', label: 'Savings', icon: 'shield', kind: 'investment', accentIndex: 1, blurb: 'Invested less lent out' },
];

function startOfMonth(): number {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export default function SegregatedScreen() {
  const colors = useColors();
  const {
    transactions,
    investments,
    debts,
    isReady,
    error,
    refresh,
    addTransaction,
    unreadNotificationCount,
  } = useFinance();
  const [view, setView] = useState<SegmentedView>('expense');
  const [showAdd, setShowAdd] = useState(false);

  const monthStart = useMemo(startOfMonth, []);
  const thisMonth = useMemo(
    () => transactions.filter((item) => item.occurredAt >= monthStart),
    [transactions, monthStart],
  );

  const totals = useMemo(() => {
    const income = thisMonth.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountMinor, 0);
    const expenses = thisMonth.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountMinor, 0);
    const invested = thisMonth.filter((item) => item.kind === 'investment').reduce((sum, item) => sum + item.amountMinor, 0);
    const outstanding = debts
      .filter((debt) => debt.status === 'active')
      .reduce((sum, debt) => sum + debt.principalMinor - debt.repaidMinor, 0);
    return {
      income,
      expenses,
      savings: invested - outstanding,
      invested,
      outstanding,
      net: income - expenses,
    };
  }, [thisMonth, debts]);

  const groups = useMemo(() => {
    const income: TransactionRecord[] = [];
    const expense: TransactionRecord[] = [];
    const savings: TransactionRecord[] = [];
    for (const item of thisMonth) {
      if (item.kind === 'income') income.push(item);
      else if (item.kind === 'expense') expense.push(item);
      else savings.push(item);
    }
    return {
      income: { rows: income, total: totals.income },
      expense: { rows: expense, total: totals.expenses },
      savings: { rows: savings, total: totals.invested },
    };
  }, [thisMonth, totals]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of groups[view].rows) {
      map.set(item.category, (map.get(item.category) ?? 0) + item.amountMinor);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [groups, view]);

  const active = TABS.find((tab) => tab.key === view) ?? TABS[0]!;
  const activeGradient = accentGradient(colors, active.accentIndex);
  const activeTint = colors.chartColors[active.accentIndex];
  const activeGroup = groups[view];
  const headline = view === 'savings' ? totals.savings : activeGroup.total;

  const openAdd = () => {
    if (view === 'savings') {
      router.push('/(tabs)/lending');
      return;
    }
    setShowAdd(true);
  };

  return (
    <Page
      title="Money flow"
      subtitle="Income, expenses, and savings kept apart"
      right={
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadNotificationCount > 0 ? `Alerts, ${unreadNotificationCount} unread` : 'Alerts'}
            testID="open-notifications"
            onPress={() => router.push('/(tabs)/notifications')}
            style={({ pressed }) => [
              styles.alertButton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="bell" size={17} color={colors.foreground} />
            {unreadNotificationCount > 0 ? (
              <View style={[styles.alertBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.alertBadgeText, { color: colors.primaryForeground }]}>
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            testID="open-settings"
            onPress={() => router.push('/(tabs)/settings')}
            style={({ pressed }) => [
              styles.alertButton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="settings" size={17} color={colors.foreground} />
          </Pressable>
        </View>
      }
    >
      <Animated.View entering={FadeInDown.duration(400)}>
        <View style={[styles.segment, { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 }]}>
          {TABS.map((tab) => {
            const selected = view === tab.key;
            const gradient = accentGradient(colors, tab.accentIndex);
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                testID={`segment-${tab.key}`}
                onPress={() => setView(tab.key)}
                style={styles.segmentButton}
              >
                {selected ? (
                  <LinearGradient
                    colors={gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                <Feather
                  name={tab.icon}
                  size={13}
                  color={selected ? '#FFFFFF' : colors.mutedForeground}
                />
                <Text style={[styles.segmentText, { color: selected ? '#FFFFFF' : colors.mutedForeground }]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>

      <Animated.View key={view} entering={FadeInDown.duration(360)} layout={LinearTransition.duration(240)}>
        <GlossPanel accentIndex={active.accentIndex} intensity="vivid" style={styles.headlinePanel}>
          <View style={styles.headlineTop}>
            <View style={styles.headlineIcon}>
              <Feather name={active.icon} size={18} color={colors.primaryForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headlineLabel, { color: colors.primaryForeground }]}>
                {active.label.toUpperCase()} THIS MONTH
              </Text>
              <Text style={[styles.headlineCaption, { color: colors.sheen }]}>{active.blurb}</Text>
            </View>
          </View>
          <Text style={[styles.headlineAmount, { color: colors.primaryForeground }]}>
            {view === 'savings' && totals.savings < 0 ? '−' : ''}
            {money(Math.abs(headline), true)}
          </Text>
          {view === 'savings' ? (
            <View style={styles.savingsBreakdown}>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>CONTRIBUTED</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>{money(totals.invested, true)}</Text>
              </View>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>OUT ON LOAN</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>{money(totals.outstanding, true)}</Text>
              </View>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>ALL-TIME INVESTED</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>
                  {money(investments.reduce((sum, item) => sum + item.amountMinor, 0), true)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.savingsBreakdown}>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>ENTRIES</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>{activeGroup.rows.length}</Text>
              </View>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>LARGEST</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>
                  {money(byCategory[0]?.[1] ?? 0, true)}
                </Text>
              </View>
              <View>
                <Text style={[styles.breakdownLabel, { color: colors.sheen }]}>AVERAGE</Text>
                <Text style={[styles.breakdownValue, { color: colors.primaryForeground }]}>
                  {money(
                    activeGroup.rows.length > 0 ? Math.round(activeGroup.total / activeGroup.rows.length) : 0,
                    true,
                  )}
                </Text>
              </View>
            </View>
          )}
        </GlossPanel>
      </Animated.View>

      {byCategory.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(70).duration(380)}>
          <SectionTitle title={`${active.label} by category`} />
          <GlossPanel style={styles.breakdownPanel}>
            {byCategory.slice(0, 6).map(([category, amount], index) => {
              const share = amount / Math.max(1, activeGroup.total);
              // Each category rail gets its own accent, derived from the active
              // view so the bars stay related but still individually scannable.
              const railGradient = accentGradient(colors, active.accentIndex + index);
              return (
                <View key={category} style={styles.categoryLine}>
                  <View style={styles.categoryTop}>
                    <LinearGradient
                      colors={railGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.categoryIcon}
                    >
                      <Feather name={categoryIcon(category)} size={13} color="#FFFFFF" />
                    </LinearGradient>
                    <Text style={[styles.categoryName, { color: colors.foreground }]}>{category}</Text>
                    <Text style={[styles.categoryAmount, { color: colors.foreground }]}>{money(amount, true)}</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.muted }]}>
                    <LinearGradient
                      colors={railGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.trackFill, { width: `${Math.max(4, Math.round(share * 100))}%` }]}
                    />
                  </View>
                </View>
              );
            })}
          </GlossPanel>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.delay(120).duration(380)}>
        <SectionTitle
          title={view === 'savings' ? 'Contributions' : `${active.label} entries`}
          trailing={
            <Pressable accessibilityRole="button" testID="segregated-add" onPress={openAdd}>
              <Text style={[styles.link, { color: activeTint }]}>
                {view === 'savings' ? 'Manage loans' : 'Add'}
              </Text>
            </Pressable>
          }
        />
        <GlossPanel intensity="solid" style={styles.listPanel}>
          {error ? (
            <View style={styles.errorState}>
              <Text style={[styles.errorTitle, { color: colors.destructive }]}>Local ledger unavailable</Text>
              <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>{error}</Text>
              <ActionButton title="Try again" icon="refresh-cw" onPress={() => void refresh()} secondary />
            </View>
          ) : !isReady ? (
            <View style={styles.loadingRow}>
              <Feather name="loader" size={17} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground }}>Opening your ledger…</Text>
            </View>
          ) : activeGroup.rows.length === 0 ? (
            <EmptyState
              icon={active.icon}
              title={`No ${active.label.toLowerCase()} yet`}
              message={
                view === 'savings'
                  ? 'Record contributions and loans to see what you have set aside.'
                  : `Add a ${view} entry or import from Gmail to fill this view.`
              }
              action={<ActionButton title={view === 'savings' ? 'Open lending book' : 'Add entry'} icon="plus" onPress={openAdd} />}
            />
          ) : (
            activeGroup.rows.slice(0, 40).map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))
          )}
        </GlossPanel>
      </Animated.View>

      <QuickAddSheet
        visible={showAdd}
        initialKind={view === 'expense' ? 'expense' : 'income'}
        onClose={() => setShowAdd(false)}
        onSave={addTransaction}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  alertButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  alertBadge: { position: 'absolute', top: 5, right: 5, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  alertBadgeText: { fontSize: 9, fontWeight: '700' },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 17, marginBottom: 14, overflow: 'hidden' },
  segmentButton: { flex: 1, minHeight: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 4, flexDirection: 'row', overflow: 'hidden' },
  segmentText: { fontSize: 12, fontWeight: '700' },
  headlinePanel: { padding: 18 },
  headlineTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  headlineIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.24)' },
  headlineLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  headlineCaption: { fontSize: 11, marginTop: 4 },
  headlineAmount: { fontSize: 34, fontWeight: '700', letterSpacing: -1.2, marginTop: 16 },
  savingsBreakdown: { flexDirection: 'row', gap: 18, marginTop: 18, paddingTop: 15, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.3)' },
  breakdownLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.9 },
  breakdownValue: { fontSize: 14, fontWeight: '700', marginTop: 5 },
  breakdownPanel: { gap: 15 },
  categoryLine: { gap: 7 },
  categoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  categoryName: { flex: 1, fontSize: 12, fontWeight: '600' },
  categoryAmount: { fontSize: 12, fontWeight: '700' },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 4 },
  listPanel: { paddingHorizontal: 14, paddingVertical: 6, marginBottom: 18 },
  link: { fontSize: 11, fontWeight: '700' },
  errorState: { alignItems: 'flex-start', padding: 13, gap: 8 },
  errorTitle: { fontSize: 13, fontWeight: '700' },
  errorBody: { fontSize: 11, lineHeight: 16 },
  loadingRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});