import React, { useMemo, useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ActionButton, EmptyState, Page, Panel, SectionTitle, money, toMinor } from '@/components/finance-ui';
import { useFinance } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import type { DebtRecord } from '@/lib/database';

function AddLoanSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { borrower: string; phone: string; principalMinor: number; interestRate: number; givenAt: number; dueAt: number }) => Promise<void>;
}) {
  const colors = useColors();
  const dueInitial = useMemo(() => {
    const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, []);
  const [borrower, setBorrower] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [interest, setInterest] = useState('');
  const [dueDate, setDueDate] = useState(dueInitial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const principalMinor = toMinor(amount);
    const parsedDue = new Date(`${dueDate}T09:00:00`).getTime();
    const interestRate = Number(interest || '0');
    if (!borrower.trim() || !principalMinor || !Number.isFinite(parsedDue) || parsedDue <= Date.now()) {
      Alert.alert('Check the details', 'Add a borrower, an amount, and a future due date.');
      return;
    }
    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) {
      Alert.alert('Check the interest rate', 'Use a rate between 0% and 100%.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        borrower: borrower.trim(),
        phone: phone.trim(),
        principalMinor,
        interestRate,
        givenAt: Date.now(),
        dueAt: parsedDue,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBorrower('');
      setPhone('');
      setAmount('');
      setInterest('');
      onClose();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalShade, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close loan form" />
        <KeyboardAwareScrollViewCompat
          style={[styles.formSheet, { backgroundColor: colors.card }]}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          bottomOffset={30}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.formHeading}>
            <View>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>Record a loan</Text>
              <Text style={[styles.formSubtitle, { color: colors.mutedForeground }]}>Keep the terms and due date together.</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={21} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>BORROWER</Text>
          <TextInput testID="loan-borrower" value={borrower} onChangeText={setBorrower} placeholder="Full name" placeholderTextColor={colors.mutedForeground} autoCapitalize="words" style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} />
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>WHATSAPP PHONE (OPTIONAL)</Text>
          <TextInput testID="loan-phone" value={phone} onChangeText={setPhone} placeholder="Country code + number" placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} />
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PRINCIPAL</Text>
          <TextInput testID="loan-amount" value={amount} onChangeText={setAmount} placeholder="₹ 0" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} />
          <View style={styles.inlineFields}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>INTEREST % (OPTIONAL)</Text>
              <TextInput testID="loan-interest" value={interest} onChangeText={setInterest} placeholder="0" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} />
            </View>
            <View style={{ flex: 1.2 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>DUE DATE</Text>
              <TextInput testID="loan-due-date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]} />
            </View>
          </View>
          <Text style={[styles.reminderNote, { color: colors.mutedForeground }]}>
            If reminders are enabled, Mira will notify you on the due date. WhatsApp opens with a draft; you choose whether to send it.
          </Text>
          <ActionButton title="Save loan" icon="check" onPress={save} loading={saving} testID="save-loan" />
        </KeyboardAwareScrollViewCompat>
      </View>
    </Modal>
  );
}

function RepaymentSheet({
  debt,
  onClose,
  onSave,
}: {
  debt: DebtRecord | null;
  onClose: () => void;
  onSave: (id: string, amountMinor: number) => Promise<void>;
}) {
  const colors = useColors();
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const outstanding = debt ? debt.principalMinor - debt.repaidMinor : 0;
  return (
    <Modal visible={!!debt} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalShade, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close repayment form" />
        <View style={[styles.repaymentSheet, { backgroundColor: colors.card }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.formTitle, { color: colors.foreground }]}>Record repayment</Text>
          <Text style={[styles.formSubtitle, { color: colors.mutedForeground }]}>
            Outstanding principal · {money(outstanding)}
          </Text>
          <TextInput
            testID="repayment-amount"
            value={amount}
            onChangeText={setAmount}
            placeholder={`Up to ${money(outstanding)}`}
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            style={[styles.field, styles.repaymentInput, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
          />
          <View style={styles.inlineFields}>
            <ActionButton title="Cancel" secondary onPress={onClose} style={{ flex: 1 }} />
            <ActionButton
              title="Save repayment"
              icon="check"
              loading={saving}
              testID="save-repayment"
              onPress={async () => {
                if (!debt) return;
                const amountMinor = toMinor(amount);
                if (!amountMinor || amountMinor > outstanding) {
                  Alert.alert('Check the amount', `Enter an amount up to ${money(outstanding)}.`);
                  return;
                }
                setSaving(true);
                try {
                  await onSave(debt.id, amountMinor);
                  setAmount('');
                  onClose();
                } catch (error) {
                  Alert.alert('Could not save', error instanceof Error ? error.message : 'Try again.');
                } finally {
                  setSaving(false);
                }
              }}
              style={{ flex: 1.5 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function sendWhatsAppReminder(debt: DebtRecord): void {
  const outstanding = debt.principalMinor - debt.repaidMinor;
  const due = new Date(debt.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const message = `Hi ${debt.borrower}, just a reminder about the ${money(outstanding)} repayment due on ${due}. Please let me know when convenient.`;
  const phone = debt.phone?.replace(/[^\d]/g, '');
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  void Linking.openURL(url).catch(() => Alert.alert('WhatsApp is unavailable', 'Install WhatsApp or check your browser settings.'));
}

export default function LendingScreen() {
  const colors = useColors();
  const { debts, addDebt, recordRepayment } = useFinance();
  const [showAdd, setShowAdd] = useState(false);
  const [repaymentDebt, setRepaymentDebt] = useState<DebtRecord | null>(null);
  const active = debts.filter((debt) => debt.status === 'active');
  const settled = debts.filter((debt) => debt.status === 'settled');
  const outstanding = active.reduce((sum, debt) => sum + debt.principalMinor - debt.repaidMinor, 0);

  return (
    <Page
      title="Lending book"
      subtitle="Keep personal loans clear and kind"
      right={<Pressable accessibilityRole="button" testID="add-loan" onPress={() => setShowAdd(true)} style={({ pressed }) => [styles.addLoanButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Feather name="plus" size={17} color={colors.primaryForeground} /><Text style={{ color: colors.primaryForeground, fontSize: 12, fontWeight: '700' }}>Add</Text></Pressable>}
    >
      <View style={[styles.loanSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.loanSummaryIcon, { backgroundColor: colors.subtleGreen }]}><Feather name="book-open" size={19} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>STILL TO COLLECT</Text>
          <Text style={[styles.summaryAmount, { color: colors.foreground }]}>{money(outstanding)}</Text>
        </View>
        <Text style={[styles.loanCount, { color: colors.mutedForeground }]}>{active.length} active</Text>
      </View>

      <Animated.View entering={FadeInDown.duration(400)}>
        <SectionTitle title="Active loans" />
        {active.length === 0 ? (
          <Panel>
            <EmptyState icon="users" title="No loans to follow up" message="Add money you've lent to someone and keep the due date in one place." action={<ActionButton title="Add a loan" icon="plus" onPress={() => setShowAdd(true)} />} />
          </Panel>
        ) : active.map((debt) => {
          const remaining = debt.principalMinor - debt.repaidMinor;
          const progress = Math.min(1, debt.repaidMinor / debt.principalMinor);
          const isOverdue = debt.dueAt < Date.now();
          return (
            <Panel key={debt.id} style={styles.debtCard}>
              <View style={styles.debtTop}>
                <View style={[styles.borrowerAvatar, { backgroundColor: colors.subtleGreen }]}>
                  <Text style={[styles.borrowerInitial, { color: colors.primary }]}>{debt.borrower.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.borrowerName, { color: colors.foreground }]}>{debt.borrower}</Text>
                  <Text style={[styles.debtDate, { color: isOverdue ? colors.destructive : colors.mutedForeground }]}>
                    {isOverdue ? 'Overdue' : 'Due'} · {new Date(debt.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <Text style={[styles.debtBalance, { color: colors.foreground }]}>{money(remaining)}</Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                <View style={[styles.progressBar, { backgroundColor: colors.primary, width: `${Math.max(5, progress * 100)}%` }]} />
              </View>
              <View style={styles.debtDetailRow}>
                <Text style={[styles.debtMeta, { color: colors.mutedForeground }]}>Lent {money(debt.principalMinor)}</Text>
                <Text style={[styles.debtMeta, { color: colors.mutedForeground }]}>{debt.interestRate ? `${debt.interestRate}% interest` : 'No interest'}</Text>
              </View>
              <View style={styles.debtActions}>
                <Pressable accessibilityRole="button" testID={`whatsapp-${debt.id}`} onPress={() => sendWhatsAppReminder(debt)} style={({ pressed }) => [styles.secondaryAction, { backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 }]}>
                  <Feather name="message-circle" size={15} color={colors.primary} /><Text style={[styles.debtActionText, { color: colors.foreground }]}>Remind</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID={`repay-${debt.id}`} onPress={() => setRepaymentDebt(debt)} style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.primary, opacity: pressed ? 0.75 : 1 }]}>
                  <Feather name="check" size={15} color={colors.primaryForeground} /><Text style={[styles.debtActionText, { color: colors.primaryForeground }]}>Record payment</Text>
                </Pressable>
              </View>
            </Panel>
          );
        })}
      </Animated.View>

      {settled.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <SectionTitle title="Settled" />
          <Panel style={styles.settledPanel}>
            {settled.slice(0, 8).map((debt) => (
              <View key={debt.id} style={styles.settledRow}>
                <Feather name="check-circle" size={17} color={colors.positive} />
                <Text style={[styles.settledName, { color: colors.foreground }]}>{debt.borrower}</Text>
                <Text style={[styles.settledAmount, { color: colors.mutedForeground }]}>{money(debt.principalMinor)}</Text>
              </View>
            ))}
          </Panel>
        </Animated.View>
      ) : null}

      <AddLoanSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={async (input) => { await addDebt(input); }}
      />
      <RepaymentSheet
        debt={repaymentDebt}
        onClose={() => setRepaymentDebt(null)}
        onSave={recordRepayment}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  addLoanButton: { height: 40, borderRadius: 14, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', gap: 6, flexDirection: 'row' },
  loanSummary: { flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderRadius: 24, padding: 17, marginBottom: 6 },
  loanSummaryIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  summaryAmount: { fontSize: 23, fontWeight: '700', marginTop: 4 },
  loanCount: { fontSize: 10 },
  debtCard: { padding: 16 },
  debtTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  borrowerAvatar: { width: 39, height: 39, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  borrowerInitial: { fontSize: 15, fontWeight: '700' },
  borrowerName: { fontSize: 14, fontWeight: '700' },
  debtDate: { fontSize: 10, marginTop: 4 },
  debtBalance: { fontSize: 15, fontWeight: '700' },
  progressTrack: { height: 5, borderRadius: 3, marginTop: 16, overflow: 'hidden' },
  progressBar: { height: '100%', borderRadius: 3 },
  debtDetailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  debtMeta: { fontSize: 10 },
  debtActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  secondaryAction: { flex: 1, minHeight: 41, borderRadius: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
  primaryAction: { flex: 1.35, minHeight: 41, borderRadius: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
  debtActionText: { fontSize: 10, fontWeight: '700' },
  settledPanel: { paddingHorizontal: 14, paddingVertical: 3 },
  settledRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  settledName: { flex: 1, fontSize: 12, fontWeight: '600' },
  settledAmount: { fontSize: 11, fontWeight: '600' },
  modalShade: { flex: 1, justifyContent: 'flex-end' },
  formSheet: { maxHeight: '92%', minHeight: '56%', paddingHorizontal: 22, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  formContent: { paddingTop: 11, paddingBottom: 28, gap: 9 },
  handle: { width: 42, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 17 },
  formHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  formTitle: { fontSize: 21, fontWeight: '700' },
  formSubtitle: { fontSize: 12, marginTop: 5, lineHeight: 17 },
  fieldLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 5 },
  field: { height: 47, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 13 },
  inlineFields: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  reminderNote: { fontSize: 10, lineHeight: 16, marginTop: 2, marginBottom: 4 },
  repaymentSheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 22, paddingTop: 11, gap: 11 },
  repaymentInput: { marginVertical: 7 },
});