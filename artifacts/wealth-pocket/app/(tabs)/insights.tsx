import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { accentGradient, GlossPanel, Page, SectionTitle, categoryIcon, money } from '@/components/finance-ui';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { TransactionRecord } from '@/lib/database';

interface MonthSummary {
  label: string;
  income: number;
  spending: number;
}

interface DaySummary {
  label: string;
  dateKey: number;
  amount: number;
  isToday: boolean;
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

function getDailySpending(transactions: TransactionRecord[]): DaySummary[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totals = new Map<number, number>();
  transactions.forEach((transaction) => {
    if (transaction.kind !== 'expense') return;
    const date = new Date(transaction.occurredAt);
    date.setHours(0, 0, 0, 0);
    totals.set(date.getTime(), (totals.get(date.getTime()) ?? 0) + transaction.amountMinor);
  });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return {
      label: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(date),
      dateKey: date.getTime(),
      amount: totals.get(date.getTime()) ?? 0,
      isToday: index === 6,
    };
  });
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Cash-flow line chart with an animated draw-in and tap-to-inspect.
 *
 * Built on react-native-svg plus Reanimated rather than victory-native: the
 * workspace pins a 1-day minimum release age for supply-chain safety, and the
 * existing dependency set already covers every animation used here. Tapping a
 * column lifts a crosshair and surfaces exact figures in the readout below.
 */
function CashFlowChart({
  values,
  width,
  height,
  selectedIndex,
  onSelect,
}: {
  values: MonthSummary[];
  width: number;
  height: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const colors = useColors();
  const progress = useSharedValue(0);
  const pulse = useSharedValue(0);

  const inset = { left: 12, right: 12, top: 20, bottom: 26 };
  const innerWidth = Math.max(1, width - inset.left - inset.right);
  const innerHeight = Math.max(1, height - inset.top - inset.bottom);
  const maxValue = Math.max(1, ...values.flatMap((item) => [item.income, item.spending]));

  useEffect(() => {
    progress.set(0);
    progress.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [progress, values]);

  useEffect(() => {
    pulse.set(0);
    pulse.set(withSequence(withTiming(1, { duration: 260 }), withTiming(0, { duration: 260 })));
  }, [pulse, selectedIndex]);

  const xFor = (index: number) =>
    inset.left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
  const yFor = (amount: number) => inset.top + innerHeight - (amount / maxValue) * innerHeight;

  const pathFor = (key: 'income' | 'spending') =>
    values
      .map((item, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(item[key])}`)
      .join(' ');

  // Each series is animated on the UI thread via strokeDashoffset so the draw-in
  // stays smooth while the JS thread handles the tap state. SVG props are driven
  // with animatedProps (not style), which is how Reanimated reaches react-native-svg
  // attributes.
  const dashLength = (values.length + 2) * innerWidth;
  const incomeProps = useAnimatedProps(() => ({
    strokeDashoffset: dashLength * (1 - progress.value),
  }));
  const spendingProps = useAnimatedProps(() => ({
    strokeDashoffset: dashLength * (1 - progress.value),
  }));
  const pulseProps = useAnimatedProps(() => ({
    opacity: 0.25 + pulse.value * 0.35,
    r: 5 + pulse.value * 4,
  }));

  const handleTouch = (locationX: number) => {
    if (values.length === 0) return;
    const ratio = (locationX - inset.left) / Math.max(1, innerWidth);
    const index = Math.round(ratio * (values.length - 1));
    onSelect(Math.min(values.length - 1, Math.max(0, index)));
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Cash flow chart for the last ${values.length} months`}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(event) => handleTouch(event.nativeEvent.locationX)}
      onResponderMove={(event) => handleTouch(event.nativeEvent.locationX)}
      onResponderRelease={() => undefined}
    >
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((fraction) => {
          const y = inset.top + innerHeight * fraction;
          return (
            <Line
              key={fraction}
              x1={inset.left}
              y1={y}
              x2={width - inset.right}
              y2={y}
              stroke={colors.border}
              strokeWidth={1}
              strokeDasharray="2 5"
            />
          );
        })}

        {values[selectedIndex] ? (
          <Line
            x1={xFor(selectedIndex)}
            y1={inset.top - 6}
            x2={xFor(selectedIndex)}
            y2={inset.top + innerHeight}
            stroke={colors.primary}
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.6}
          />
        ) : null}

        <AnimatedPath
          d={pathFor('income')}
          stroke={colors.primary}
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
strokeDasharray={dashLength}
          animatedProps={incomeProps}
        />
        <AnimatedPath
          d={pathFor('spending')}
          stroke={colors.accent}
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
strokeDasharray={dashLength}
          animatedProps={spendingProps}
        />

        {values.map((item, index) => (
          <React.Fragment key={`dots-${item.label}-${index}`}>
            {index === selectedIndex ? (
              <AnimatedCircle
                cx={xFor(index)}
                cy={yFor(item.income)}
                fill={colors.primary}
                animatedProps={pulseProps}
              />
            ) : null}
            <Circle cx={xFor(index)} cy={yFor(item.income)} r={3} fill={colors.primary} />
            <Circle cx={xFor(index)} cy={yFor(item.spending)} r={3} fill={colors.accent} />
          </React.Fragment>
        ))}

        {values.map((item, index) => (
          <SvgText
            key={`label-${item.label}-${index}`}
            x={xFor(index)}
            y={height - 6}
            fill={index === selectedIndex ? colors.primary : colors.mutedForeground}
            fontSize={index === selectedIndex ? 10 : 9}
            fontWeight={index === selectedIndex ? '700' : '400'}
            textAnchor="middle"
          >
            {item.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** Horizontal bar that grows from zero on mount and on data change. */
function AnimatedBar({
  fraction,
  color,
  trackColor,
  height = 74,
}: {
  fraction: number;
  color: string;
  trackColor: string;
  height?: number;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(withTiming(Math.max(fraction > 0 ? 0.04 : 0.015, fraction), {
      duration: 720,
      easing: Easing.out(Easing.cubic),
    }));
  }, [fraction, progress]);
  const style = useAnimatedStyle(() => ({ height: Math.max(3, height * progress.value) }));
  return (
    <View style={[styles.dailyTrack, { backgroundColor: trackColor }]}>
      <Animated.View style={[styles.dailyBar, { backgroundColor: color }, style]} />
    </View>
  );
}

/** Progress rail for the category breakdown, animated on value change. */
function AnimatedRail({ fraction, color, trackColor }: { fraction: number; color: string; trackColor: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(withTiming(Math.max(0.04, fraction), { duration: 760, easing: Easing.out(Easing.cubic) }));
  }, [fraction, progress]);
  const style = useAnimatedStyle(() => ({
    width: `${Math.max(4, Math.min(100, progress.value * 100))}%`,
  }));
  return (
    <View style={[styles.track, { backgroundColor: trackColor }]}>
      <Animated.View style={[styles.trackFill, { backgroundColor: color }, style]} />
    </View>
  );
}

/** Count-up number used for the headline figures. */
function AnimatedAmount({ value, compact, color }: { value: number; compact: boolean; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(withTiming(1, { duration: 780, easing: Easing.out(Easing.cubic) }));
  }, [progress, value]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: (1 - progress.value) * 9 }],
  }));
  return (
    <Animated.Text style={[styles.remaining, { color }, style]}>
      {money(value, compact)}
    </Animated.Text>
  );
}

export default function InsightsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { transactions, investments, debts } = useFinance();
  const series = useMemo(() => getMonthSeries(transactions), [transactions]);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const dailySeries = useMemo(() => getDailySpending(transactions), [transactions]);
  const weekSpending = dailySeries.reduce((sum, day) => sum + day.amount, 0);
  const maxDailySpending = Math.max(1, ...dailySeries.map((day) => day.amount));
  const peakDay = dailySeries.reduce<DaySummary | null>(
    (peak, day) => day.amount > (peak?.amount ?? 0) ? day : peak,
    null,
  );
  const now = new Date();
  const thisMonth = useMemo(() => transactions.filter((item) => {
    const date = new Date(item.occurredAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }), [transactions, now.getFullYear(), now.getMonth()]);
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
  // Default the crosshair to the newest month so the readout is never empty.
  const activeMonthIndex = selectedMonth ?? Math.max(0, series.length - 1);
  const activeMonth = series[activeMonthIndex];

  return (
    <Page title="Insights" subtitle="See where today is taking you">
      <Animated.View entering={FadeInDown.duration(420)}>
        <View style={styles.flowCards}>
          {/* Vivid hero tiles: money-in reads green, money-out reads violet, so
              the pair is distinguishable before any numbers are parsed. */}
          <GlossPanel intensity="vivid" accentIndex={0} style={styles.flowCard}>
            <Text style={[styles.overline, { color: colors.sheen }]}>MONEY IN</Text>
            <Text style={[styles.flowAmount, { color: colors.primaryForeground }]}>{money(income, true)}</Text>
          </GlossPanel>
          <GlossPanel intensity="vivid" accentIndex={1} style={styles.flowCard}>
            <Text style={[styles.overline, { color: colors.sheen }]}>MONEY OUT</Text>
            <Text style={[styles.flowAmount, { color: colors.primaryForeground }]}>{money(spending + investing, true)}</Text>
          </GlossPanel>
        </View>
        <GlossPanel style={styles.balancePanel}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.overline, { color: colors.mutedForeground }]}>MONTHLY REMAINING</Text>
            <AnimatedAmount value={liquid} compact={false} color={colors.foreground} />
            <Text style={[styles.remainingCaption, { color: colors.mutedForeground }]}>After spending, contributions & active loans</Text>
          </View>
          <View style={[styles.balanceGlyph, { backgroundColor: colors.subtleGreen }]}>
            <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '700' }}>₹</Text>
          </View>
        </GlossPanel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(420)}>
        <SectionTitle title="Cash flow" />
        <GlossPanel style={styles.chartPanel}>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.primary }]} /><Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>In</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.accent }]} /><Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>Out</Text></View>
            <Text style={[styles.chartHint, { color: colors.mutedForeground }]}>Last 6 months</Text>
          </View>
          {transactions.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add transactions to see your cash-flow trend.</Text>
            </View>
          ) : (
            <>
              <CashFlowChart
                values={series}
                width={chartWidth}
                height={174}
                selectedIndex={activeMonthIndex}
                onSelect={setSelectedMonth}
              />
              {activeMonth ? (
                <View style={[styles.readout, { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 }]}>
                  <Text style={[styles.readoutLabel, { color: colors.primary }]}>{activeMonth.label.toUpperCase()}</Text>
                  <View style={styles.readoutRow}>
                    <View style={styles.readoutItem}>
                      <Text style={[styles.readoutKey, { color: colors.mutedForeground }]}>In</Text>
                      <Text style={[styles.readoutValue, { color: colors.positive }]}>{money(activeMonth.income, true)}</Text>
                    </View>
                    <View style={styles.readoutItem}>
                      <Text style={[styles.readoutKey, { color: colors.mutedForeground }]}>Out</Text>
                      <Text style={[styles.readoutValue, { color: colors.accent }]}>{money(activeMonth.spending, true)}</Text>
                    </View>
                    <View style={styles.readoutItem}>
                      <Text style={[styles.readoutKey, { color: colors.mutedForeground }]}>Net</Text>
                      <Text
                        style={[
                          styles.readoutValue,
                          { color: activeMonth.income - activeMonth.spending >= 0 ? colors.positive : colors.destructive },
                        ]}
                      >
                        {money(activeMonth.income - activeMonth.spending, true)}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}
              <Text style={[styles.chartHint, { color: colors.mutedForeground }]}>Tap a month to inspect</Text>
            </>
          )}
        </GlossPanel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(130).duration(420)}>
        <SectionTitle
          title="Spending rhythm"
          trailing={<Text style={[styles.chartHint, { color: colors.mutedForeground }]}>Past 7 days</Text>}
        />
        <GlossPanel style={styles.dailyPanel}>
          <View style={styles.dailySummary}>
            <View>
              <Text style={[styles.overline, { color: colors.mutedForeground }]}>TOTAL SPENT</Text>
              <Text style={[styles.dailyTotal, { color: colors.foreground }]}>{money(weekSpending, true)}</Text>
            </View>
            {peakDay ? (
              <View style={[styles.peakBadge, { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 }]}>
                <Feather name="arrow-up-right" size={13} color={colors.accent} />
                <Text style={[styles.peakLabel, { color: colors.mutedForeground }]}>Peak · {peakDay.label}</Text>
              </View>
            ) : null}
          </View>
          {transactions.length === 0 ? (
            <View style={styles.dailyEmpty}>
              <Feather name="bar-chart-2" size={19} color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add expenses to see your weekly spending pattern.</Text>
            </View>
          ) : (
            <View style={styles.dailyBars}>
              {dailySeries.map((day, index) => {
                const barColor = colors.chartColors[index % colors.chartColors.length] ?? colors.primary;
                const barHeight = day.amount > 0
                  ? Math.max(7, Math.round((day.amount / maxDailySpending) * 74))
                  : 3;
                return (
                  <View key={day.dateKey} style={styles.dailyColumn}>
                    <Text numberOfLines={1} style={[styles.dailyAmount, { color: colors.mutedForeground }]}>
                      {day.amount > 0 ? money(day.amount, true) : '—'}
                    </Text>
                    <AnimatedBar
                      fraction={barHeight / 74}
                      color={day.amount > 0 ? barColor : colors.border}
                      trackColor={colors.muted}
                    />
                    <Text style={[styles.dailyDay, { color: day.isToday ? colors.primary : colors.mutedForeground }]}>{day.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </GlossPanel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(420)}>
        <SectionTitle title="Spending by category" />
        <GlossPanel style={styles.breakdownPanel}>
          {categories.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Your category breakdown will appear here.</Text>
          ) : categories.slice(0, 8).map(([category, amount], index) => {
            const categoryColor = colors.chartColors[index % colors.chartColors.length] ?? colors.primary;
            return (
            <View key={category} style={styles.categoryLine}>
              <View style={styles.categoryTop}>
                <View style={styles.categoryLabel}>
                  <View style={[styles.categoryIcon, { backgroundColor: `${categoryColor}1F` }]}>
                    <Feather name={categoryIcon(category)} size={14} color={categoryColor} />
                  </View>
                  <Text style={[styles.categoryName, { color: colors.foreground }]}>{category}</Text>
                </View>
                <View style={styles.categoryAmountGroup}>
                  <Text style={[styles.categoryAmount, { color: colors.foreground }]}>{money(amount)}</Text>
                  <Text style={[styles.categoryShare, { color: colors.mutedForeground }]}>
                    {Math.round((amount / Math.max(1, categoryTotal)) * 100)}%
                  </Text>
                </View>
              </View>
              <AnimatedRail
                fraction={amount / Math.max(1, categoryTotal)}
                color={categoryColor}
                trackColor={colors.muted}
              />
            </View>
          );})}
        </GlossPanel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(240).duration(420)}>
        <SectionTitle title="Investment portfolio" />
        <GlossPanel style={styles.portfolioPanel}>
          <View style={styles.portfolioTotal}>
            <View>
              <Text style={[styles.overline, { color: colors.mutedForeground }]}>TOTAL CONTRIBUTED</Text>
              <Text style={[styles.portfolioValue, { color: colors.foreground }]}>{money(totalInvested)}</Text>
            </View>
            <LinearGradient
              colors={accentGradient(colors, 0)}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.portfolioIcon}
            >
              <Feather name="trending-up" size={18} color="#FFFFFF" />
            </LinearGradient>
          </View>
          {bucketTotals.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground, marginTop: 18 }]}>Add an investment to start tracking SIPs, insurance, stocks, or your emergency fund.</Text>
          ) : bucketTotals.map(([bucket, amount], index) => (
            <View key={bucket} style={[styles.bucketRow, { borderTopColor: colors.border }]}>
              <View style={[styles.bucketIcon, { backgroundColor: `${colors.chartColors[index % colors.chartColors.length] ?? colors.primary}1F` }]}>
                <Feather name={categoryIcon(bucket)} size={14} color={colors.chartColors[index % colors.chartColors.length] ?? colors.primary} />
              </View>
              <Text style={[styles.bucketName, { color: colors.foreground }]}>{bucket}</Text>
              <Text style={[styles.bucketAmount, { color: colors.foreground }]}>{money(amount)}</Text>
            </View>
          ))}
        </GlossPanel>
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
  readout: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11, marginTop: 10 },
  readoutLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  readoutRow: { flexDirection: 'row', gap: 18, marginTop: 9 },
  readoutItem: { gap: 4 },
  readoutKey: { fontSize: 9 },
  readoutValue: { fontSize: 13, fontWeight: '700' },
  chartEmpty: { height: 145, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 12, lineHeight: 18 },
  dailyPanel: { paddingHorizontal: 15, paddingVertical: 16 },
  dailySummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 17 },
  dailyTotal: { fontSize: 24, fontWeight: '700', marginTop: 7, letterSpacing: -0.5 },
  peakBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, paddingVertical: 7, paddingHorizontal: 9 },
  peakLabel: { fontSize: 10, fontWeight: '600' },
  dailyEmpty: { minHeight: 85, alignItems: 'center', justifyContent: 'center', gap: 8 },
  dailyBars: { flexDirection: 'row', gap: 5, alignItems: 'flex-end' },
  dailyColumn: { flex: 1, alignItems: 'center', gap: 7 },
  dailyAmount: { fontSize: 8, minHeight: 11 },
  dailyTrack: { width: '100%', height: 80, borderRadius: 9, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  dailyBar: { width: '62%', minHeight: 3, borderTopLeftRadius: 7, borderTopRightRadius: 7 },
  dailyDay: { fontSize: 9, fontWeight: '600' },
  breakdownPanel: { gap: 16 },
  categoryLine: { gap: 8 },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  categoryIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 12, fontWeight: '600' },
  categoryAmountGroup: { alignItems: 'flex-end', gap: 2 },
  categoryAmount: { fontSize: 11, fontWeight: '600' },
  categoryShare: { fontSize: 9 },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 4 },
  portfolioPanel: { marginBottom: 18 },
  portfolioTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  portfolioValue: { fontSize: 26, fontWeight: '700', marginTop: 7 },
  portfolioIcon: { width: 41, height: 41, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  bucketRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  bucketIcon: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bucketName: { flex: 1, fontSize: 12, fontWeight: '600' },
  bucketAmount: { fontSize: 12, fontWeight: '700' },
});