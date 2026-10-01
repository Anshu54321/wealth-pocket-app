import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFinance } from '@/context/FinanceContext';
import { Page, Panel, SectionTitle, ActionButton, money } from '@/components/finance-ui';
import { useColors } from '@/hooks/useColors';
import { fetchRecentGmailTransactions } from '@/lib/gmail';
import { getPendingReviewSummary } from '@/lib/database';
import {
  forgetGmailToken,
  getBiometricEnabled,
  readGmailToken,
  setBiometricEnabled,
  storeGmailToken,
} from '@/lib/security';
import {
  getReminderPermission,
  getReminderPreference,
  notifyPendingCategories,
  requestReminderPermission,
  setReminderPreference,
} from '@/lib/notifications';

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export default function SettingsScreen() {
  const colors = useColors();
  const { transactions, debts, scheduleActiveDebtReminders, importTransactions, deleteAllData } = useFinance();
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleExpiry, setGoogleExpiry] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const currentClientId =
    Platform.OS === 'ios' ? iosClientId : Platform.OS === 'android' ? androidClientId : webClientId;
  const needsOAuthSetup = !currentClientId;

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      readGmailToken().catch(() => null),
      getBiometricEnabled().catch(() => false),
      getReminderPreference().catch(() => false),
      getReminderPermission().catch(() => false),
    ]).then(([token, biometric, reminderEnabled, permission]) => {
      if (!mounted) return;
      setGoogleConnected(!!token);
      setGoogleExpiry(token?.expiresAt ?? 0);
      setBiometrics(biometric);
      setNotificationsEnabled(reminderEnabled);
      setNotificationsGranted(permission);
    });
    return () => { mounted = false; };
  }, []);

  const connectGoogle = () => Alert.alert(
    'Google OAuth needs setup',
    'Create an OAuth client for this app in Google Cloud, enable the Gmail API, and add the EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID value for this platform. Client IDs are public identifiers, not client secrets.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Google Cloud', onPress: () => void Linking.openURL('https://console.cloud.google.com/apis/credentials') },
    ],
  );

  const syncGmail = async () => {
    const stored = await readGmailToken().catch(() => null);
    if (!stored || stored.expiresAt <= Date.now() + 30_000) {
      Alert.alert('Reconnect Google', 'Your read-only Gmail access has expired. Connect again to continue syncing.');
      setGoogleConnected(false);
      return;
    }
    setSyncing(true);
    try {
      const parsed = await fetchRecentGmailTransactions(stored.token);
      const result = await importTransactions(parsed);
      const pending = await getPendingReviewSummary();
      await notifyPendingCategories(pending.count, pending.transactionId);
      Alert.alert(
        'Sync complete',
        `${result.inserted} new transaction${result.inserted === 1 ? '' : 's'} added. ${parsed.length - result.inserted} duplicate${parsed.length - result.inserted === 1 ? '' : 's'} skipped.`,
      );
    } catch (error) {
      Alert.alert('Could not sync Gmail', error instanceof Error ? error.message : 'Try again when your connection is available.');
    } finally {
      setSyncing(false);
    }
  };

  const toggleBiometrics = async (value: boolean) => {
    if (!value) {
      await setBiometricEnabled(false);
      setBiometrics(false);
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert('Device security only', 'Biometric unlock is available on iOS and Android devices.');
      return;
    }
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      Alert.alert('Biometrics not ready', 'Set up Face ID, Touch ID, or Android biometrics in your device settings first.');
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Enable Mira protection',
      fallbackLabel: 'Use device passcode',
      disableDeviceFallback: false,
    });
    if (!result.success) return;
    await setBiometricEnabled(true);
    setBiometrics(true);
  };

  const toggleNotifications = async (value: boolean) => {
    if (!value) {
      await setReminderPreference(false);
      setNotificationsEnabled(false);
      return;
    }
    const granted = await requestReminderPermission();
    setNotificationsGranted(granted);
    if (!granted) {
      Alert.alert('Notifications are off', 'Allow notifications for Mira in your device settings to receive repayment reminders.');
      return;
    }
    await setReminderPreference(true);
    await scheduleActiveDebtReminders();
    setNotificationsEnabled(true);
  };

  const exportLedger = async () => {
    const rows = [
      'Date,Type,Merchant,Category,Amount INR',
      ...transactions.map((item) => [
        new Date(item.occurredAt).toISOString(),
        item.kind,
        `"${item.merchant.replace(/"/g, '""')}"`,
        `"${item.category.replace(/"/g, '""')}"`,
        (item.amountMinor / 100).toFixed(2),
      ].join(',')),
    ];
    try {
      await Share.share({ title: 'Mira finance ledger', message: rows.join('\n') });
    } catch {
      Alert.alert('Export unavailable', 'Your device could not open the share sheet.');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete all local finance data?',
      'This permanently removes transactions, learned merchant categories, investment entries, lending records, and repayments from this device, and cancels scheduled Mira notifications. Your Google connection is removed separately.',
      [
        { text: 'Keep data', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => Alert.alert(
            'Confirm permanent deletion',
            'This cannot be undone. Delete all finance data from this device?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => void deleteAllData()
                  .then(() => Alert.alert('Finance data deleted', 'Local records and scheduled Mira notifications were removed. Your Google connection remains connected.'))
                  .catch((error) => Alert.alert('Could not delete finance data', error instanceof Error ? error.message : 'Try again from Settings.')),
              },
            ],
          ),
        },
      ],
    );
  };

  return (
    <Page title="Settings" subtitle="Privacy, connections & preferences">
      <SectionTitle title="Google transaction import" />
      <Panel style={styles.googlePanel}>
        <View style={styles.connectionHeader}>
          <View style={[styles.googleMark, { backgroundColor: colors.secondary }]}>
            <Feather name="mail" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Gmail alerts</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              {googleConnected && googleExpiry > Date.now() ? 'Read-only connection active' : 'Connect your own Google account'}
            </Text>
          </View>
          {googleConnected ? <View style={[styles.statusDot, { backgroundColor: colors.positive }]} /> : null}
        </View>
        <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>
          Google will show its consent screen for Gmail read-only access. Mira scans recent messages on request, keeps transaction details on this device, and does not save raw email text or send mail.
        </Text>
        {googleConnected ? (
          <View style={styles.googleActions}>
            <ActionButton title="Sync recent alerts" icon="refresh-cw" onPress={() => void syncGmail()} loading={syncing} testID="sync-gmail" style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              testID="disconnect-google"
              onPress={() => Alert.alert('Disconnect Google?', 'This removes Mira’s saved Google access token. Imported transactions stay in your local ledger.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: () => void forgetGmailToken().then(() => { setGoogleConnected(false); setGoogleExpiry(0); }) },
              ])}
              style={({ pressed }) => [styles.disconnectButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
            >
              <Feather name="log-out" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : needsOAuthSetup ? (
          <ActionButton
            title="Set up Google OAuth"
            icon="arrow-up-right"
            onPress={connectGoogle}
            testID="connect-google"
          />
        ) : (
          <GoogleAuthButton
            clientId={currentClientId}
            onConnected={(expiresAt) => {
              setGoogleConnected(true);
              setGoogleExpiry(expiresAt);
            }}
          />
        )}
        <View style={styles.scopeRow}>
          <Feather name="lock" size={13} color={colors.primary} />
          <Text style={[styles.scopeText, { color: colors.mutedForeground }]}>Scope: gmail.readonly · Sync is manual · Last 30 days</Text>
        </View>
      </Panel>

      <SectionTitle title="Device protection" />
      <Panel style={styles.preferencePanel}>
        <PreferenceRow
          icon="shield"
          title="Biometric unlock"
          description="Ask for Face ID, Touch ID, or device passcode when Mira returns to the foreground."
          value={biometrics}
          onValueChange={(value) => void toggleBiometrics(value)}
        />
        <View style={[styles.preferenceDivider, { backgroundColor: colors.border }]} />
        <PreferenceRow
          icon="bell"
          title="Repayment reminders"
          description={notificationsGranted ? 'Local reminders are scheduled on this device.' : 'Allow local notifications for due-date reminders.'}
          value={notificationsEnabled}
          onValueChange={(value) => void toggleNotifications(value)}
        />
      </Panel>

      <SectionTitle title="Your data" />
      <Panel style={styles.dataPanel}>
        <DataAction icon="download" title="Export transaction ledger" subtitle={`${transactions.length} entries · CSV in your share sheet`} onPress={() => void exportLedger()} />
        <View style={[styles.preferenceDivider, { backgroundColor: colors.border }]} />
        <DataAction icon="trash-2" title="Delete all finance data" subtitle={`${debts.length} lending records · cannot be undone`} danger onPress={confirmDelete} />
      </Panel>

      <SectionTitle title="How Mira protects you" />
      <Panel style={styles.securityPanel}>
        <SecurityPoint icon="smartphone" title="Local-first ledger" text="Transactions, investments, and lending records stay in the app’s local SQLite database. Native release builds enable SQLCipher encryption." />
        <SecurityPoint icon="key" title="Secure credentials" text="Google access tokens and the database encryption key are stored in iOS Keychain or Android Keystore." />
        <SecurityPoint icon="eye-off" title="No email archive" text="Gmail message bodies are parsed in memory and discarded. Only transaction fields are retained." />
        <SecurityPoint icon="alert-triangle" title="Preview security" text="Expo Go and web previews do not provide SQLCipher database encryption. Do not use real financial records in a development preview." />
      </Panel>
      <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>MIRA · PERSONAL FINANCE · INR</Text>
    </Page>
  );
}

function GoogleAuthButton({
  clientId,
  onConnected,
}: {
  clientId: string;
  onConnected: (expiresAt: number) => void;
}) {
  const handledResponse = useRef<string | null>(null);
  const clientConfig = Platform.OS === 'ios'
    ? { iosClientId: clientId }
    : Platform.OS === 'android'
      ? { androidClientId: clientId }
      : { webClientId: clientId };
  const [request, response, promptAsync] = Google.useAuthRequest(
    {
      ...clientConfig,
      responseType: AuthSession.ResponseType.Code,
      shouldAutoExchangeCode: Platform.OS !== 'web',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      extraParams: { access_type: 'online', prompt: 'consent' },
    },
    { scheme: 'wealth-pocket' },
  );

  useEffect(() => {
    if (!response || (response.type !== 'success' && response.type !== 'error')) return;
    const responseKey = response.params.code ?? response.params.access_token ?? response.params.error ?? JSON.stringify(response.params);
    if (handledResponse.current === responseKey) return;
    handledResponse.current = responseKey;
    if (response.type === 'error') {
      Alert.alert('Google connection did not finish', response.error?.message ?? response.params.error_description ?? 'Return to Mira and try again.');
      return;
    }
    void (async () => {
      try {
        let authentication = response.authentication;
        if (!authentication?.accessToken && response.params.code && request) {
          authentication = await AuthSession.exchangeCodeAsync(
            {
              clientId,
              code: response.params.code,
              redirectUri: request.redirectUri,
              extraParams: { code_verifier: request.codeVerifier ?? '' },
            },
            Google.discovery,
          );
        }
        const token = authentication?.accessToken;
        if (!token) {
          Alert.alert('Google connection did not finish', 'Return to Mira and try connecting again.');
          return;
        }
        const expiresAt = Date.now() + Math.max(0, authentication?.expiresIn ?? 3600) * 1000;
        await storeGmailToken(token, expiresAt);
        onConnected(expiresAt);
        Alert.alert('Google connected', 'Mira can now read recent transaction-alert emails only.');
      } catch {
        Alert.alert('Google connection could not be saved', 'Check your OAuth client setup and try connecting again.');
      }
    })();
  }, [response, request, clientId, onConnected]);

  return (
    <ActionButton
      title="Continue with Google"
      icon="arrow-up-right"
      onPress={() => void promptAsync()}
      disabled={!request}
      testID="connect-google"
    />
  );
}

function PreferenceRow({
  icon,
  title,
  description,
  value,
  onValueChange,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.preferenceRow}>
      <View style={[styles.preferenceIcon, { backgroundColor: colors.secondary }]}><Feather name={icon} size={16} color={colors.accent} /></View>
      <View style={styles.preferenceText}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        testID={`toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.subtleGreen }}
        thumbColor={value ? colors.primary : colors.mutedForeground}
      />
    </View>
  );
}

function DataAction({
  icon,
  title,
  subtitle,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.dataAction, { opacity: pressed ? 0.7 : 1 }]}>
      <Feather name={icon} size={17} color={danger ? colors.destructive : colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: danger ? colors.destructive : colors.foreground }]}>{title}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

function SecurityPoint({ icon, title, text }: { icon: keyof typeof Feather.glyphMap; title: string; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.securityPoint}>
      <Feather name={icon} size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  googlePanel: { gap: 13 },
  connectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  googleMark: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '700' },
  cardSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  privacyCopy: { fontSize: 11, lineHeight: 17 },
  googleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disconnectButton: { width: 48, height: 48, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  scopeText: { fontSize: 9 },
  preferencePanel: { paddingHorizontal: 15, paddingVertical: 4 },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  preferenceIcon: { width: 35, height: 35, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  preferenceText: { flex: 1 },
  preferenceDivider: { height: StyleSheet.hairlineWidth, marginLeft: 44 },
  dataPanel: { paddingHorizontal: 15, paddingVertical: 2 },
  dataAction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15 },
  securityPanel: { gap: 18 },
  securityPoint: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  versionLabel: { fontSize: 9, textAlign: 'center', letterSpacing: 1.2, marginTop: 9, marginBottom: 8 },
});