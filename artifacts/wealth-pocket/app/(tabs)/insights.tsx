import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Page, Panel, SectionTitle, money } from '@/components/finance-ui';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { TransactionRecord } from '@/lib/database';

interface MonthSummary {
  label: string;
  income: number;
  spending: number;
}

function getMonthSeries(transactions: TransactionRecord[]): MonthSummary[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const totals = transactions.reduce((result, transaction) => {
      const date = new Date(transaction.occurredAt);
      if (date.getFullYear() !== month.getFullYear() || date.getMonth() !== month.getMonth()) return result;
      if (transaction.kind === 'income') result.income += transaction.amountMinor;
      if (transaction.kind === 'expense') result.spending += transaction.amountMinor;
      return result;
    }, { income: 0, spending: 0 });
    return {
      label: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(month),
      ...totals,
    };
  });
}

function CashFlowChart({ values, width, height }: { values: MonthSummary[]; width: number; height: number }) {
  const colors = useColors();
  const inset = { left: 10, right: 10, top: 18, bottom: 26 };
  const innerWidth = Math.max(1, width - inset.left - inset.right);
  const innerHeight = Math.max(1, height - inset.top - inset.bottom);
  const maxValue = Math.max(1, ...values.flatMap((item) => [item.income, item.spending]));
  const pathFor = (key: 'income' | 'spending') => values.map((item, index) => {
    const x = inset.left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
    const y = inset.top + innerHeight - (item[key] / maxValue) * innerHeight;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <Svg width={width} height={height}>
      {[0, 0.5, 1].map((fraction) => {
        const y = inset.top + innerHeight * fraction;
        return <Line key={fraction} x1={inset.left} y1={y} x2={width - inset.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="2 5" />;
      })}
      <Path d={pathFor('income')} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={pathFor('spending')} stroke={colors.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((item, index) => {
        const x = inset.left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
        const y = inset.top + innerHeight - (item.income / maxValue) * innerHeight;
        return <Circle key={`${item.label}-${index}`} cx={x} cy={y} r={3} fill={colors.primary} />;
      })}
      {values.map((item, index) => {
        const x = inset.left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
        return <SvgText key={`label-${item.label}-${index}`} x={x} y={height - 6} fill={colors.mutedForeground} fontSize={9} textAnchor="middle">{item.label}</SvgText>;
      })}
    </Svg>
  );
}

export default function InsightsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { transactions, investments, debts } = useFinance();
  const series = useMemo(() => getMonthSeries(transactions), [transactions]);
  const now = new Date();
  const thisMonth = transactions.filter((item) => {
    const date = new Date(item.occurredAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const income = thisMonth.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountMinor, 0);
  const spending = thisMonth.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountMinor, 0);
  const investing = thisMonth.filter((item) => item.kind === 'investment').reduce((sum, item) => sum + item.amountMinor, 0);
  const totalInvested = investments.reduce((sum, item) => sum + item.amountMinor, 0);
  const outstanding = debts.filter((item) => item.status === 'active')
    .reduce((sum, item) => sum + item.principalMinor - item.repaidMinor, 0);
  const liquid = income - spending - investing - outstanding;
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    thisMonth.filter((item) => item.kind === 'expense').forEach((item) => {
      totals.set(item.category, (totals.get(item.category) ?? 0) + item.amountMinor);
    });
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [thisMonth]);
  const bucketTotals = useMemo(() => {
    const totals = new Map<string, number>();
    investments.forEach((item) => totals.set(item.bucket, (totals.get(item.bucket) ?? 0) + item.amountMinor));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [investments]);
  const chartWidth = Math.max(260, Math.min(width - 72, 520));
  const categoryTotal = categories.reduce((sum, [, amount]) => sum + amount, 0);

  return (
    <Page title="Insights" subtitle="See where today is taking you">
      <Animated.View entering={FadeInDown.duration(420)}>
        <View style={styles.flowCards}>
          <Panel style={styles.flowCard}>
            <Text style={[styles.overline, { color: colors.mutedForeground }]}>MONEY IN</Text>
            <Text style={[styles.flowAmount, { color: colors.positive }]}>{money(income, true)}</Text>
          </Panel>
          <Panel style={styles.flowCard}>
            <Text style={[styles.overline, { color: colors.mutedForeground }]}>MONEY OUT</Text>
            <Text style={[styles.flowAmount, { color: colors.accent }]}>{money(spending + investing, true)}</Text>
          </Panel>
        </View>
        <Panel style={styles.balancePanel}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.overline, { color: colors.mutedForeground }]}>MONTHLY REMAINING</Text>
            <Text style={[styles.remaining, { color: colors.foreground }]}>{money(liquid)}</Text>
            <Text style={[styles.remainingCaption, { color: colors.mutedForeground }]}>After spending, contributions & active loans</Text>
          </View>
          <View style={[styles.balanceGlyph, { backgroundColor: colors.subtleGreen }]}>
            <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '700' }}>₹</Text>
          </View>
        </Panel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(420)}>
        <SectionTitle title="Cash flow" />
        <Panel style={styles.chartPanel}>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.primary }]} /><Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>In</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.accent }]} /><Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>Out</Text></View>
            <Text style={[styles.chartHint, { color: colors.mutedForeground }]}>Last 6 months</Text>
          </View>
          {transactions.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add transactions to see your cash-flow trend.</Text>
            </View>
          ) : <CashFlowChart values={series} width={chartWidth} height={174} />}
        </Panel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(140).duration(420)}>
        <SectionTitle title="Spending by category" />
        <Panel style={styles.breakdownPanel}>
          {categories.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Your category breakdown will appear here.</Text>
          ) : categories.slice(0, 8).map(([category, amount]) => (
            <View key={category} style={styles.categoryLine}>
              <View style={styles.categoryTop}>
                <Text style={[styles.categoryName, { color: colors.foreground }]}>{category}</Text>
                <Text style={[styles.categoryAmount, { color: colors.mutedForeground }]}>{money(amount)}</Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.secondary }]}>
                <View style={[styles.trackFill, { backgroundColor: colors.primary, width: `${Math.max(4, Math.round(amount / Math.max(1, categoryTotal) * 100))}%` }]} />
              </View>
            </View>
          ))}
        </Panel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(420)}>
        <SectionTitle title="Investment portfolio" />
        <Panel style={styles.portfolioPanel}>
          <View style={styles.portfolioTotal}>
            <View>
              <Text style={[styles.overline, { color: colors.mutedForeground }]}>TOTAL CONTRIBUTED</Text>
              <Text style={[styles.portfolioValue, { color: colors.foreground }]}>{money(totalInvested)}</Text>
            </View>
            <View style={[styles.portfolioIcon, { backgroundColor: colors.subtleGreen }]}>
              <Feather name="trending-up" size={18} color={colors.primary} />
            </View>
          </View>
          {bucketTotals.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground, marginTop: 18 }]}>Add an investment to start tracking SIPs, insurance, stocks, or your emergency fund.</Text>
          ) : bucketTotals.map(([bucket, amount]) => (
            <View key={bucket} style={[styles.bucketRow, { borderTopColor: colors.border }]}>
              <View style={[styles.bucketBullet, { backgroundColor: colors.primary }]} />
              <Text style={[styles.bucketName, { color: colors.foreground }]}>{bucket}</Text>
              <Text style={[styles.bucketAmount, { color: colors.foreground }]}>{money(amount)}</Text>
            </View>
          ))}
        </Panel>
      </Animated.View>
    </Page>
  );
}

const styles = StyleSheet.create({
  flowCards: { flexDirection: 'row', gap: 9 },
  flowCard: { flex: 1, padding: 15, marginBottom: 10 },
  overline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  flowAmount: { fontSize: 19, fontWeight: '700', marginTop: 8, letterSpacing: -0.4 },
  balancePanel: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  remaining: { fontSize: 27, fontWeight: '700', letterSpacing: -0.8, marginTop: 8 },
  remainingCaption: { fontSize: 10, marginTop: 5 },
  balanceGlyph: { width: 43, height: 43, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  chartPanel: { padding: 16, paddingBottom: 7 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 5 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10 },
  chartHint: { marginLeft: 'auto', fontSize: 10 },
  chartEmpty: { height: 145, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 12, lineHeight: 18 },
  breakdownPanel: { gap: 16 },
  categoryLine: { gap: 8 },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryName: { fontSize: 12, fontWeight: '600' },
  categoryAmount: { fontSize: 11, fontWeight: '600' },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 4 },
  portfolioPanel: { marginBottom: 18 },
  portfolioTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  portfolioValue: { fontSize: 26, fontWeight: '700', marginTop: 7 },
  portfolioIcon: { width: 41, height: 41, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  bucketRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  bucketBullet: { width: 6, height: 6, borderRadius: 3 },
  bucketName: { flex: 1, fontSize: 12, fontWeight: '600' },
  bucketAmount: { fontSize: 12, fontWeight: '700' },
});