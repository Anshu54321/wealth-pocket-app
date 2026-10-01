import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import type { TransactionRecord } from '@/lib/database';

export function money(minor: number, compact = false): string {
  const amount = minor / 100;
  if (compact && Math.abs(amount) >= 100000) {
    return `₹${(amount / 100000).toFixed(1)}L`;
  }
  if (compact && Math.abs(amount) >= 1000) {
    return `₹${(amount / 1000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function toMinor(value: string): number {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

export function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(timestamp);
}

export function categoryIcon(category: string): keyof typeof Feather.glyphMap {
  const key = category.toLowerCase();
  if (/food|dining|restaurant/.test(key)) return 'coffee';
  if (/transport|travel|fuel/.test(key)) return 'truck';
  if (/shop|retail/.test(key)) return 'shopping-bag';
  if (/bill|utility/.test(key)) return 'file-text';
  if (/invest|mutual|stock|insurance|emergency/.test(key)) return 'trending-up';
  if (/grocer/.test(key)) return 'shopping-cart';
  if (/health|medical/.test(key)) return 'heart';
  if (/income|salary|lending|repayment/.test(key)) return 'arrow-down-left';
  return 'circle';
}

export function Page({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1" style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Platform.OS === 'web' ? 72 : (insets.top || 0) + 8,
          paddingBottom: (insets.bottom || 0) + 108,
          paddingHorizontal: 20,
        }}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: object }) {
  const colors = useColors();
  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionText, { color: colors.foreground }]}>{title}</Text>
      {trailing}
    </View>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 44,
  disabled = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`icon-${accessibilityLabel.toLowerCase().replace(/\s+/g, '-')}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
      ]}
    >
      <Feather name={icon} size={19} color={colors.foreground} />
    </Pressable>
  );
}

export function ActionButton({
  title,
  icon,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
  testID,
  style,
}: {
  title: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: object;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: secondary ? colors.secondary : colors.primary,
          opacity: disabled || loading ? 0.55 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={secondary ? colors.foreground : colors.primaryForeground} /> : null}
      {!loading && icon ? <Feather name={icon} size={17} color={secondary ? colors.foreground : colors.primaryForeground} /> : null}
      <Text style={[styles.actionText, { color: secondary ? colors.foreground : colors.primaryForeground }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Tag({
  children,
  selected = false,
  onPress,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const content = (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: selected ? colors.subtleGreen : colors.secondary,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={[styles.tagText, { color: selected ? colors.primary : colors.mutedForeground }]}>
        {children}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
}: {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={20} color={colors.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: colors.mutedForeground }]}>{message}</Text>
      {action}
    </View>
  );
}

export function TransactionRow({
  transaction,
  onPress,
}: {
  transaction: TransactionRecord;
  onPress?: PressableProps['onPress'];
}) {
  const colors = useColors();
  const positive = transaction.kind === 'income';
  const content = (
    <View style={styles.transactionRow}>
      <View style={[styles.transactionIcon, { backgroundColor: positive ? colors.subtleGreen : colors.secondary }]}>
        <Feather name={categoryIcon(transaction.category)} size={17} color={positive ? colors.positive : colors.accent} />
      </View>
      <View style={styles.transactionMain}>
        <Text numberOfLines={1} style={[styles.transactionMerchant, { color: colors.foreground }]}>
          {transaction.merchant}
        </Text>
        <Text numberOfLines={1} style={[styles.transactionMeta, { color: colors.mutedForeground }]}>
          {transaction.category} · {shortDate(transaction.occurredAt)}
        </Text>
      </View>
      <Text style={[styles.transactionAmount, { color: positive ? colors.positive : colors.foreground }]}>
        {positive ? '+' : transaction.kind === 'investment' ? '↗ ' : '−'}
        {money(transaction.amountMinor)}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
      {content}
    </Pressable>
  );
}

export function LabeledValue({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.labeledValue}>
      <Text style={[styles.labeledValueLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.labeledValueText, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 22 },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  panel: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 18, marginBottom: 14 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 },
  sectionText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  iconButton: { justifyContent: 'center', alignItems: 'center' },
  actionButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 16, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 14, fontWeight: '700' },
  tag: { minHeight: 31, paddingHorizontal: 11, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tagText: { fontSize: 11, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 9 },
  emptyIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyMessage: { fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 275 },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  transactionIcon: { height: 40, width: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  transactionMain: { flex: 1, gap: 4 },
  transactionMerchant: { fontSize: 13, fontWeight: '600' },
  transactionMeta: { fontSize: 11 },
  transactionAmount: { fontSize: 12, fontWeight: '700', maxWidth: 112, textAlign: 'right' },
  labeledValue: { gap: 5 },
  labeledValueLabel: { fontSize: 11 },
  labeledValueText: { fontSize: 13, fontWeight: '700' },
});