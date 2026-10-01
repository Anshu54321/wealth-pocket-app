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
import {
  getSmsPermission,
  isSmsPlatformSupported,
  isSmsSyncEnabled,
  requestSmsPermission,
  setSmsSyncEnabled,
  type SmsPermissionState,
} from '@/lib/sms';

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export default function SettingsScreen() {
  const colors = useColors();
  const { transactions, debts, scheduleActiveDebtReminders, importTransactions, deleteAllData, loadDemoData, isDemoData } = useFinance();
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleExpiry, setGoogleExpiry] = useState(0);
  /**
   * Fakes the connected state so the post-auth UI can be previewed without
   * registering a Google Cloud client. It never writes a token to SecureStore,
   * so `readGmailToken()` still reports "not connected" on reload.
   */
  const [googlePreview, setGooglePreview] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [smsSyncEnabled, setSmsSyncEnabledState] = useState(false);
  const [smsPermission, setSmsPermission] = useState<SmsPermissionState>('unavailable');
  const currentClientId =
    Platform.OS === 'ios' ? iosClientId : Platform.OS === 'android' ? androidClientId : webClientId;
  const needsOAuthSetup = !currentClientId;
  const showConnectedState = googleConnected || googlePreview;

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      readGmailToken().catch(() => null),
      getBiometricEnabled().catch(() => false),
      getReminderPreference().catch(() => false),
      getReminderPermission().catch(() => false),
      isSmsSyncEnabled().catch(() => false),
      getSmsPermission().catch((): SmsPermissionState => 'unavailable'),
    ]).then(([token, biometric, reminderEnabled, permission, smsEnabled, smsPermissionState]) => {
      if (!mounted) return;
      setGoogleConnected(!!token);
      setGoogleExpiry(token?.expiresAt ?? 0);
      setBiometrics(biometric);
      setNotificationsEnabled(reminderEnabled);
      setNotificationsGranted(permission);
      setSmsSyncEnabledState(smsEnabled);
      setSmsPermission(smsPermissionState);
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

  const runDemoSync = async () => {
    // Preview-only sync: seeds the sample ledger and reports the same result
    // shape a real import would, so the sync UI and the resulting Alerts entry
    // can be reviewed without a Gmail account.
    setSyncing(true);
    try {
      await loadDemoData();
      Alert.alert(
        'Preview sync complete',
        'Sample transactions were loaded. This did not contact Google, and no access token was created.',
      );
    } finally {
      setSyncing(false);
    }
  };

  const toggleDemo = () => {
    setGooglePreview((value) => {
      const next = !value;
      if (!next) setGoogleExpiry(0);
      return next;
    });
  };

  const confirmLoadDemo = () => Alert.alert(
    'Replace all data with sample data?',
    'This deletes your current transactions, lending records, and alerts, then fills the app with six months of realistic sample data so every screen and animation can be reviewed.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load sample data',
        onPress: () => void (async () => {
          setSeeding(true);
          try {
            await loadDemoData();
          } catch (error) {
            Alert.alert('Could not load sample data', error instanceof Error ? error.message : 'Try again from Settings.');
          } finally {
            setSeeding(false);
          }
        })(),
      },
    ],
  );

  const syncGmail = async () => {
    if (googlePreview && !googleConnected) {
      await runDemoSync();
      return;
    }
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

  const toggleSmsSync = async (value: boolean) => {
    if (!value) {
      await setSmsSyncEnabled(false);
      setSmsSyncEnabledState(false);
      return;
    }
    // The opt-in is stored first and revoked on any failure, so the stored
    // preference never claims more than the OS has actually granted.
    if (!isSmsPlatformSupported()) {
      Alert.alert('Android only', 'Reading bank messages works on Android devices. Nothing is stored.');
      return;
    }
    const state = await requestSmsPermission();
    setSmsPermission(state);
    if (state !== 'granted') {
      await setSmsSyncEnabled(false);
      setSmsSyncEnabledState(false);
      Alert.alert(
        state === 'blocked' ? 'Permission blocked' : 'Permission not granted',
        state === 'blocked'
          ? 'Open this app\'s settings in Android to allow message access, then come back and turn this on again.'
          : 'Mira cannot read bank messages without this permission, so SMS sync stays off.',
      );
      return;
    }
    await setSmsSyncEnabled(true);
    setSmsSyncEnabledState(true);
  };

  const openSmsPermissionSettings = () => {
    if (Platform.OS === 'web') return;
    void Linking.openSettings().catch(() =>
      Alert.alert('Settings unavailable', 'Open this app\'s permissions in your device settings and allow messages.'),
    );
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
          {showConnectedState ? <View style={[styles.statusDot, { backgroundColor: colors.positive }]} /> : null}
        </View>
        {googlePreview && !googleConnected ? (
          <View style={[styles.previewBanner, { backgroundColor: colors.subtleGreen, borderColor: colors.primary }]}>
            <Feather name="eye" size={13} color={colors.primary} />
            <Text style={[styles.previewBannerText, { color: colors.primary }]}>
              Preview mode. Showing the connected UI with sample data. No Google account is linked and no token is stored.
            </Text>
          </View>
        ) : null}
        <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>
          Google will show its consent screen for Gmail read-only access. Mira scans recent messages on request, keeps transaction details on this device, and does not save raw email text or send mail.
        </Text>
        {showConnectedState ? (
          <View style={styles.googleActions}>
            <ActionButton
              title={googlePreview && !googleConnected ? 'Preview sync (sample data)' : 'Sync recent alerts'}
              icon="refresh-cw"
              onPress={() => void syncGmail()}
              loading={syncing}
              testID="sync-gmail"
              style={{ flex: 1 }}
            />
            <Pressable
              accessibilityRole="button"
              testID="disconnect-google"
              onPress={() => Alert.alert('Disconnect Google?', 'This removes Mira’s saved Google access token. Imported transactions stay in your local ledger.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Disconnect', style: 'destructive', onPress: () => void forgetGmailToken().then(() => { setGoogleConnected(false); setGoogleExpiry(0); setGooglePreview(false); }) },
              ])}
              style={({ pressed }) => [styles.disconnectButton, { borderColor: colors.border, opacity: pressed ? 0.65 : 1 }]}
            >
              <Feather name="log-out" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : needsOAuthSetup ? (
          <>
            <ActionButton
              title="Set up Google OAuth"
              icon="arrow-up-right"
              onPress={connectGoogle}
              testID="connect-google"
            />
            <Text style={[styles.previewHint, { color: colors.mutedForeground }]}>
              Want to see the connected state first? Turn on preview mode below.
            </Text>
          </>
        ) : (
          <GoogleAuthButton
            clientId={currentClientId}
            onConnected={(expiresAt) => {
              setGoogleConnected(true);
              setGooglePreview(false);
              setGoogleExpiry(expiresAt);
            }}
          />
        )}
        <View style={styles.scopeRow}>
          <Feather name="lock" size={13} color={colors.primary} />
          <Text style={[styles.scopeText, { color: colors.mutedForeground }]}>Scope: gmail.readonly · Sync is manual · Last 30 days</Text>
        </View>
        <View style={[styles.preferenceDivider, { backgroundColor: colors.border }]} />
        <PreferenceRow
          icon="eye"
          title="Preview connected state"
          description="Shows the post-authentication UI using sample data. Stores no token and never contacts Google."
          value={googlePreview}
          onValueChange={toggleDemo}
        />
      </Panel>

      <SectionTitle title="Automatic tracking" />
      <Panel style={styles.smsPanel}>
        <View style={styles.connectionHeader}>
          <View style={[styles.googleMark, { backgroundColor: colors.secondary }]}>
            <Feather name="message-square" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Bank messages</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              {smsSyncEnabled && smsPermission === 'granted'
                ? 'Mira can log spending and income for you'
                : 'Turn on to log transactions from bank SMS'}
            </Text>
          </View>
          {smsSyncEnabled && smsPermission === 'granted'
            ? <View style={[styles.statusDot, { backgroundColor: colors.positive }]} />
            : null}
        </View>
        <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>
          Android asks you to allow message access the first time you switch this on. Mira reads the last 30 messages only when you tap Sync, keeps the amount, merchant, and direction on this device, and never stores or uploads the message text.
        </Text>
        <PreferenceRow
          icon="message-square"
          title="Allow SMS Sync for Auto-Tracking"
          description={
            smsPermission === 'unavailable'
              ? 'Reading bank messages is available on Android devices.'
              : smsPermission === 'blocked'
                ? 'Android stopped asking. Only the system settings screen can restore message access.'
                : smsSyncEnabled && smsPermission !== 'granted'
                  ? 'Message access was withdrawn outside Mira. Turn this off and on again to re-grant.'
                  : 'Read bank SMS on demand to add income and expenses automatically.'
          }
          value={smsSyncEnabled}
          onValueChange={(value) => void toggleSmsSync(value)}
        />
        {/*
          `PermissionsAndroid.check` reports a boolean and cannot tell "denied"
          from "don't ask again", so a block is only visible as a false check.
          Offering the settings shortcut whenever the opt-in and the grant have
          drifted apart covers both, which is the only state where the user
          cannot recover by tapping the toggle again.
        */}
        {smsSyncEnabled && smsPermission !== 'granted' && smsPermission !== 'unavailable' ? (
          <>
            <View style={[styles.previewBanner, { backgroundColor: colors.subtleGreen, borderColor: colors.primary }]}>
              <Feather name="lock" size={13} color={colors.primary} />
              <Text style={[styles.previewBannerText, { color: colors.primary }]}>
                Mira no longer has message access, so SMS sync cannot run. Restore it in Android settings.
              </Text>
            </View>
            <ActionButton
              title="Open app settings"
              icon="settings"
              onPress={openSmsPermissionSettings}
              testID="open-sms-settings"
            />
          </>
        ) : null}
        <View style={styles.scopeRow}>
          <Feather name="shield" size={13} color={colors.primary} />
          <Text style={[styles.scopeText, { color: colors.mutedForeground }]}>Manual sync only · Android only · Nothing leaves this device</Text>
        </View>
      </Panel>

      <SectionTitle title="Sample data" />
      <Panel style={styles.demoPanel}>
        {isDemoData ? (
          <View style={[styles.demoBanner, { backgroundColor: colors.subtleGreen, borderColor: colors.primary }]}>
            <Feather name="info" size={13} color={colors.primary} />
            <Text style={[styles.demoBannerText, { color: colors.primary }]}>
              The ledger currently holds sample data, not real transactions.
            </Text>
          </View>
        ) : null}
        <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>
          Fills the app with six months of realistic transactions, investments, loans, and alerts so every screen, chart, and animation has something to render.
        </Text>
        <ActionButton
          title={isDemoData ? 'Reload sample data' : 'Load sample data'}
          icon="database"
          onPress={confirmLoadDemo}
          loading={seeding}
          testID="load-demo-data"
        />
        <ActionButton title="Clear all data" icon="trash-2" secondary onPress={confirmDelete} />
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
        <SecurityPoint icon="lock" title="No message archive" text="Bank SMS is read on demand, parsed on device, and discarded. Repeats are dropped using a stored fingerprint of the amount, date, and merchant, never the original text." />
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
  smsPanel: { gap: 13 },
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
  previewHint: { fontSize: 10, lineHeight: 15, textAlign: 'center' },
  previewBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 14, padding: 11 },
  previewBannerText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '600' },
  demoPanel: { gap: 13 },
  demoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, padding: 11 },
  demoBannerText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '600' },
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