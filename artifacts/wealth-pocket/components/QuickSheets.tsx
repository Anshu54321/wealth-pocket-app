import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import type { TransactionInput, TransactionKind, TransactionRecord } from '@/lib/database';
import { ActionButton, Tag, toMinor } from './finance-ui';

const expenseCategories = [
  'Food & dining', 'Groceries', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Other',
];
const incomeCategories = ['Salary', 'Business', 'Interest', 'Lending', 'Other income'];
const investmentBuckets = ['Mutual funds', 'Insurance', 'Stocks', 'Emergency fund', 'Other'];

export function QuickAddSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: TransactionInput) => Promise<void>;
}) {
  const colors = useColors();
  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState(expenseCategories[0] ?? 'Other');
  const [provider, setProvider] = useState('');
  const [saving, setSaving] = useState(false);
  const categories = useMemo(
    () => kind === 'expense' ? expenseCategories : kind === 'income' ? incomeCategories : investmentBuckets,
    [kind],
  );

  const changeKind = (nextKind: TransactionKind) => {
    setKind(nextKind);
    const nextCategories = nextKind === 'expense' ? expenseCategories : nextKind === 'income' ? incomeCategories : investmentBuckets;
    setCategory(nextCategories[0] ?? 'Other');
  };

  const save = async () => {
    const amountMinor = toMinor(amount);
    if (!amountMinor) {
      Alert.alert('Check the amount', 'Enter an amount greater than ₹0.');
      return;
    }
    if (!merchant.trim()) {
      Alert.alert('Add a name', 'Enter a merchant, source, or investment provider.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        amountMinor,
        merchant: merchant.trim(),
        category,
        kind,
        occurredAt: Date.now(),
        source: 'manual',
        investmentBucket: kind === 'investment' ? category : undefined,
        provider: provider.trim() || null,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAmount('');
      setMerchant('');
      setProvider('');
      onClose();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close add transaction" />
        <KeyboardAwareScrollViewCompat
          style={[styles.sheet, { backgroundColor: colors.card }]}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add to your ledger</Text>
              <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>Saved securely on this device</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={21} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={[styles.segment, { backgroundColor: colors.secondary }]}>
            {(['expense', 'income', 'investment'] as TransactionKind[]).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                testID={`entry-kind-${item}`}
                onPress={() => changeKind(item)}
                style={[
                  styles.segmentButton,
                  kind === item && { backgroundColor: colors.primary },
                ]}
              >
                <Text style={[styles.segmentText, { color: kind === item ? colors.primaryForeground : colors.mutedForeground }]}>
                  {item === 'expense' ? 'Spend' : item === 'income' ? 'Income' : 'Invest'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>AMOUNT</Text>
          <View style={[styles.amountInput, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Text style={[styles.currencySymbol, { color: colors.accent }]}>₹</Text>
            <TextInput
              testID="transaction-amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              returnKeyType="next"
              style={[styles.amountText, { color: colors.foreground }]}
            />
          </View>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            {kind === 'expense' ? 'MERCHANT OR NOTE' : kind === 'income' ? 'INCOME SOURCE' : 'INVESTMENT NAME'}
          </Text>
          <TextInput
            testID="transaction-merchant"
            value={merchant}
            onChangeText={setMerchant}
            placeholder={kind === 'expense' ? 'e.g. Cafe, fuel, rent' : kind === 'income' ? 'e.g. Salary' : 'e.g. Monthly SIP'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            style={[styles.textInput, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            {kind === 'investment' ? 'PORTFOLIO BUCKET' : 'CATEGORY'}
          </Text>
          <View style={styles.tagWrap}>
            {categories.map((item) => (
              <Tag key={item} selected={category === item} onPress={() => setCategory(item)}>{item}</Tag>
            ))}
          </View>

          {kind === 'investment' ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PROVIDER (OPTIONAL)</Text>
              <TextInput
                value={provider}
                onChangeText={setProvider}
                placeholder="Fund, policy, broker..."
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                style={[styles.textInput, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
              />
            </>
          ) : null}

          <ActionButton title="Save entry" icon="check" onPress={save} loading={saving} testID="save-transaction" />
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

export function CategoryReviewSheet({
  visible,
  transactions,
  onClose,
  onCategorize,
}: {
  visible: boolean;
  transactions: TransactionRecord[];
  onClose: () => void;
  onCategorize: (id: string, category: string) => Promise<void>;
}) {
  const colors = useColors();
  const choices = ['Food & dining', 'Groceries', 'Transport', 'Bills', 'Shopping', 'Health', 'Other'];
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close review" />
        <View style={[styles.reviewSheet, { backgroundColor: colors.card }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Quick review</Text>
              <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
                Choose a category once; Mira remembers this merchant.
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={21} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {transactions.length === 0 ? (
              <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground, paddingVertical: 20 }]}>
                Everything is categorized.
              </Text>
            ) : transactions.map((transaction) => (
              <View key={transaction.id} style={[styles.reviewItem, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.reviewMerchant, { color: colors.foreground }]}>{transaction.merchant}</Text>
                  <Text style={[styles.reviewAmount, { color: colors.mutedForeground }]}>
                    ₹{(transaction.amountMinor / 100).toLocaleString('en-IN')}
                  </Text>
                </View>
                <View style={styles.reviewChoices}>
                  {choices.slice(0, 4).map((choice) => (
                    <Pressable
                      key={choice}
                      accessibilityRole="button"
                      disabled={updatingId === transaction.id}
                      onPress={async () => {
                        setUpdatingId(transaction.id);
                        try {
                          await onCategorize(transaction.id, choice);
                        } finally {
                          setUpdatingId(null);
                        }
                      }}
                      style={[styles.reviewChoice, { backgroundColor: colors.secondary }]}
                    >
                      <Text style={[styles.reviewChoiceText, { color: colors.foreground }]}>{choice}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    disabled={updatingId === transaction.id}
                    onPress={async () => {
                      setUpdatingId(transaction.id);
                      try {
                        await onCategorize(transaction.id, 'Other');
                      } finally {
                        setUpdatingId(null);
                      }
                    }}
                    style={[styles.reviewChoice, { backgroundColor: colors.secondary }]}
                  >
                    <Text style={[styles.reviewChoiceText, { color: colors.foreground }]}>Other</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '91%', minHeight: '58%', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22 },
  sheetContent: { paddingTop: 11, paddingBottom: 28, gap: 10 },
  reviewSheet: { height: '76%', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 11 },
  handle: { width: 42, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 19 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  sheetTitle: { fontSize: 21, fontWeight: '700', letterSpacing: -0.5 },
  sheetSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 4, maxWidth: 280 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 15, marginVertical: 4 },
  segmentButton: { flex: 1, minHeight: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 12, fontWeight: '700' },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1, marginTop: 9 },
  amountInput: { flexDirection: 'row', borderWidth: 1, borderRadius: 16, alignItems: 'center', paddingHorizontal: 16, minHeight: 61 },
  currencySymbol: { fontSize: 23, fontWeight: '700', marginRight: 8 },
  amountText: { flex: 1, fontSize: 25, fontWeight: '700', paddingVertical: 8 },
  textInput: { height: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontSize: 14 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 3 },
  reviewItem: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13, gap: 10 },
  reviewMerchant: { fontSize: 14, fontWeight: '700' },
  reviewAmount: { fontSize: 12, marginTop: 4 },
  reviewChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reviewChoice: { borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  reviewChoiceText: { fontSize: 10, fontWeight: '600' },
});