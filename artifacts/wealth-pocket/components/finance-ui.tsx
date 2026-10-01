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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoryIcon } from '@/constants/categories';
import { useColors } from '@/hooks/useColors';
import type { TransactionRecord } from '@/lib/database';

export { categoryIcon };

/**
 * Maps an index to one of the vivid accent gradients in the active palette.
 * Callers pass a stable index (e.g. category position) so a given category keeps
 * its colour across screens and rebuilds.
 */
export function accentGradient(colors: ReturnType<typeof useColors>, index: number) {
  return colors.accentGradients[Math.abs(index) % colors.accentGradients.length];
}

export function accentColor(colors: ReturnType<typeof useColors>, index: number) {
  return colors.chartColors[Math.abs(index) % colors.chartColors.length];
}

/**
 * A rounded gradient card with a specular highlight across the top third.
 *
 * The sheen is a separate absolutely-positioned overlay rather than a second
 * gradient stop on the fill: that keeps the highlight's falloff independent of
 * the brand gradient, so swapping `colors.gloss` does not disturb the gloss.
 */
export function GlossPanel({
  children,
  style,
  intensity = 'soft',
  accentIndex,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `solid` flattens the fill to a plain surface, for dense list containers. */
  intensity?: 'soft' | 'solid' | 'vivid';
  /** When set, fills with the accent gradient instead of the neutral gloss. */
  accentIndex?: number;
}) {
  const colors = useColors();
  const gradient =
    intensity === 'vivid' && accentIndex !== undefined
      ? accentGradient(colors, accentIndex)
      : intensity === 'vivid'
        ? colors.glossStrong
        : colors.gloss;
  const flat = intensity === 'solid';
  return (
    <View
      style={[
        styles.glossPanel,
        { borderColor: colors.glassBorder, shadowColor: colors.shadow },
        flat ? { backgroundColor: colors.card, shadowOpacity: 0.04 } : null,
        style,
      ]}
    >
      <LinearGradient
        colors={flat ? [colors.card, colors.card] : gradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {flat ? null : (
        <LinearGradient
          colors={[colors.sheen, 'transparent', 'transparent']}
          locations={[0, 0.42, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.glossSheen]}
        />
      )}
      {children}
    </View>
  );
}

/** Translucent pill used for chips, filters, and inline legends. */
export function GlossChip({
  children,
  accentIndex,
  icon,
  selected = false,
}: {
  children: ReactNode;
  accentIndex?: number;
  icon?: keyof typeof Feather.glyphMap;
  selected?: boolean;
}) {
  const colors = useColors();
  const tint = accentIndex === undefined ? colors.primary : accentColor(colors, accentIndex);
  return (
    <View
      style={[
        styles.glossChip,
        {
          backgroundColor: selected ? colors.card : colors.glass,
          borderColor: selected ? tint : colors.glassBorder,
        },
      ]}
    >
      {icon ? <Feather name={icon} size={12} color={tint} /> : null}
      <Text style={[styles.glossChipText, { color: selected ? colors.foreground : colors.mutedForeground }]}>
        {children}
      </Text>
    </View>
  );
}

/** Large figure with a gradient fill, used for hero totals. */
export function GradientText({ text, size = 30, style }: { text: string; size?: number; style?: object }) {
  const colors = useColors();
  return (
    <Text
      style={[
        styles.gradientText,
        { fontSize: size, lineHeight: size * 1.16, color: colors.primary },
        style,
      ]}
    >
      {text}
    </Text>
  );
}

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
    <View className="flex-1" style={styles.page}>
      <LinearGradient
        colors={colors.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
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

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <GlossPanel style={[styles.panel, style]}>
      {children}
    </GlossPanel>
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
  icon,
  selected = false,
  onPress,
}: {
  children: ReactNode;
  icon?: keyof typeof Feather.glyphMap;
  selected?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const content = (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: selected ? colors.subtleGreen : colors.glass,
          borderColor: selected ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      {icon ? <Feather name={icon} size={12} color={selected ? colors.primary : colors.mutedForeground} /> : null}
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
  // Geometry lives on glossPanel; Panel only overrides it where a screen needs
  // a flatter or tighter card.
  panel: {},
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 },
  sectionText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  iconButton: { justifyContent: 'center', alignItems: 'center' },
  actionButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 16, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 14, fontWeight: '700' },
  tag: { minHeight: 31, paddingHorizontal: 11, borderRadius: 20, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
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
  page: { flex: 1 },
  glossPanel: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    marginBottom: 14,
    overflow: 'hidden',
    // Colored, low-opacity elevation. On light backgrounds a neutral grey shadow
    // reads as dirt, so the shadow borrows the brand hue.
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  glossSheen: { borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  glossChip: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glossChipText: { fontSize: 11, fontWeight: '600' },
  gradientText: { fontWeight: '800', letterSpacing: -1 },
});