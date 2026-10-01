import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyState, Page, Panel, SectionTitle, TransactionRow, money } from '@/components/finance-ui';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { TransactionRecord } from '@/lib/database';

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function CalendarScreen() {
  const colors = useColors();
  const { transactions } = useFinance();
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(dayKey(Date.now()));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month);
  const firstOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const cellWidth = (Math.min(width, 520) - 40 - 16) / 7;

  const transactionsByDate = useMemo(() => {
    const map = new Map<string, TransactionRecord[]>();
    transactions.forEach((transaction) => {
      const key = dayKey(transaction.occurredAt);
      const current = map.get(key) ?? [];
      current.push(transaction);
      map.set(key, current);
    });
    return map;
  }, [transactions]);
  const days = Array.from({ length: firstOffset + totalDays }, (_, index) => index < firstOffset ? null : index - firstOffset + 1);
  const selectedTransactions = transactionsByDate.get(selectedDay) ?? [];
  const dailyIncome = selectedTransactions.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountMinor, 0);
  const dailyExpense = selectedTransactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountMinor, 0);
  const dailyInvestment = selectedTransactions.filter((item) => item.kind === 'investment').reduce((sum, item) => sum + item.amountMinor, 0);

  const moveMonth = (delta: number) => {
    const next = new Date(year, monthIndex + delta, 1);
    setMonth(next);
    setSelectedDay(dateKey(next.getFullYear(), next.getMonth(), 1));
  };

  return (
    <Page title="Calendar" subtitle="Your month, one day at a time">
      <Animated.View entering={FadeInDown.duration(430)}>
        <Panel style={styles.calendarPanel}>
          <View style={styles.monthHeader}>
            <Pressable accessibilityRole="button" testID="previous-month" onPress={() => moveMonth(-1)} style={styles.monthArrow}>
              <Feather name="chevron-left" size={20} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.monthName, { color: colors.foreground }]}>{monthName}</Text>
            <Pressable accessibilityRole="button" testID="next-month" onPress={() => moveMonth(1)} style={styles.monthArrow}>
              <Feather name="chevron-right" size={20} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={styles.calendarGrid}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => (
              <View key={`${weekday}-${index}`} style={[styles.dayCell, { width: cellWidth }]}>
                <Text style={[styles.weekday, { color: colors.mutedForeground }]}>{weekday}</Text>
              </View>
            ))}
            {days.map((day, index) => {
              if (day === null) return <View key={`blank-${index}`} style={[styles.dayCell, { width: cellWidth }]} />;
              const key = dateKey(year, monthIndex, day);
              const dayTransactions = transactionsByDate.get(key) ?? [];
              const expense = dayTransactions
                .filter((item) => item.kind === 'expense')
                .reduce((sum, item) => sum + item.amountMinor, 0);
              const isSelected = selectedDay === key;
              const isToday = dayKey(Date.now()) === key;
              const intensity = expense > 2000000 ? 0.9 : expense > 500000 ? 0.62 : expense > 0 ? 0.36 : 0;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`${monthName} ${day}${expense ? `, expenses ${money(expense)}` : ''}`}
                  testID={`calendar-day-${key}`}
                  onPress={() => setSelectedDay(key)}
                  style={[
                    styles.dayCell,
                    { width: cellWidth },
                    isSelected && { backgroundColor: colors.subtleGreen, borderColor: colors.primary, borderWidth: 1 },
                    !isSelected && isToday && { borderColor: colors.accent, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.dayNumber, { color: isSelected ? colors.primary : colors.foreground }]}>{day}</Text>
                  {dayTransactions.length > 0 ? (
                    <View style={[styles.dayDot, { backgroundColor: expense ? colors.primary : colors.accent, opacity: intensity || 0.85 }]} />
                  ) : <View style={styles.dayDotPlaceholder} />}
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.legend, { borderTopColor: colors.border }]}>
            <View style={[styles.dayDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Spending activity</Text>
            <View style={[styles.dayDot, { backgroundColor: colors.accent, marginLeft: 14 }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Income / investment</Text>
          </View>
        </Panel>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(430)}>
        <SectionTitle title={new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} />
        <View style={styles.dailySummary}>
          <Panel style={styles.dailyCard}>
            <Text style={[styles.dailyLabel, { color: colors.mutedForeground }]}>IN</Text>
            <Text style={[styles.dailyAmount, { color: colors.positive }]}>{money(dailyIncome, true)}</Text>
          </Panel>
          <Panel style={styles.dailyCard}>
            <Text style={[styles.dailyLabel, { color: colors.mutedForeground }]}>OUT</Text>
            <Text style={[styles.dailyAmount, { color: colors.foreground }]}>{money(dailyExpense, true)}</Text>
          </Panel>
          <Panel style={styles.dailyCard}>
            <Text style={[styles.dailyLabel, { color: colors.mutedForeground }]}>INVESTED</Text>
            <Text style={[styles.dailyAmount, { color: colors.accent }]}>{money(dailyInvestment, true)}</Text>
          </Panel>
        </View>
        <Panel style={styles.detailPanel}>
          {selectedTransactions.length === 0 ? (
            <EmptyState icon="calendar" title="A quiet day" message="No transactions were recorded for this date." />
          ) : selectedTransactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </Panel>
      </Animated.View>
    </Page>
  );
}

const styles = StyleSheet.create({
  calendarPanel: { paddingHorizontal: 14, paddingTop: 16 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  monthName: { fontSize: 16, fontWeight: '700' },
  monthArrow: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  dayCell: { height: 43, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginBottom: 1 },
  weekday: { fontSize: 10, fontWeight: '700' },
  dayNumber: { fontSize: 12, fontWeight: '600' },
  dayDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  dayDotPlaceholder: { width: 4, height: 4, marginTop: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 9, paddingTop: 13, paddingBottom: 2 },
  legendText: { fontSize: 10, marginLeft: 6 },
  dailySummary: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  dailyCard: { flex: 1, padding: 12, marginBottom: 10 },
  dailyLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  dailyAmount: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  detailPanel: { paddingHorizontal: 14, paddingVertical: 6 },
});