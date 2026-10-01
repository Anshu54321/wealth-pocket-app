import '../global.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ActionButton } from '@/components/finance-ui';
import { FinanceProvider } from '@/context/FinanceContext';
import { useColors } from '@/hooks/useColors';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { getBiometricEnabled, setBiometricEnabled } from '@/lib/security';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { categorizeTransaction } from '@/lib/database';
import { registerFinanceNotificationActions, REVIEW_ACTION_CATEGORIES } from '@/lib/notifications';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back', contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

function SecurityGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const prompting = useRef(false);
  const wasBackgrounded = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return false;
    prompting.current = true;
    setLocked(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Mira',
        cancelLabel: 'Not now',
        fallbackLabel: 'Use device passcode',
        disableDeviceFallback: false,
      });
      setLocked(!result.success);
      return result.success;
    } catch {
      setLocked(true);
      return false;
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const processedResponses = new Set<string>();
    const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
      const { notification, actionIdentifier } = response;
      const responseKey = `${notification.request.identifier}:${actionIdentifier}`;
      if (processedResponses.has(responseKey)) return;
      processedResponses.add(responseKey);
      const data = notification.request.content.data as { action?: unknown; transactionId?: unknown };
      const category = REVIEW_ACTION_CATEGORIES[actionIdentifier];
      if (category && typeof data.transactionId === 'string') {
        try {
          await categorizeTransaction(data.transactionId, category);
        } catch (error) {
          Alert.alert('Could not categorize transaction', error instanceof Error ? error.message : 'Open Mira and try again.');
        }
      }
      router.push(data.action === 'review-transactions' ? '/' : '/(tabs)/lending');
      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    void registerFinanceNotificationActions().catch(() => undefined);
    void (async () => {
      const biometricEnabled = await getBiometricEnabled().catch(() => false);
      if (!mounted) return;
      if (Platform.OS === 'web' || !biometricEnabled) {
        setEnabled(false);
        setLocked(false);
        setReady(true);
        return;
      }
      setEnabled(true);
      setLocked(true);
      const hasHardware = await LocalAuthentication.hasHardwareAsync().catch(() => false);
      const enrolled = await LocalAuthentication.isEnrolledAsync().catch(() => false);
      if (!hasHardware || !enrolled) {
        await setBiometricEnabled(false);
        if (mounted) {
          setEnabled(false);
          setLocked(false);
          setReady(true);
        }
        return;
      }
      await unlock();
      if (mounted) setReady(true);
    })();

    const stateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        wasBackgrounded.current = true;
        return;
      }
      if (nextState === 'active' && wasBackgrounded.current) {
        wasBackgrounded.current = false;
        void getBiometricEnabled().then(async (biometricEnabled) => {
          if (!biometricEnabled || Platform.OS === 'web' || prompting.current) return;
          setEnabled(true);
          await unlock();
        });
      }
    });
    const notificationSub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response);
    });
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => response ? handleNotificationResponse(response) : undefined)
      .catch(() => undefined);
    return () => {
      mounted = false;
      stateSub.remove();
      notificationSub.remove();
    };
  }, [unlock]);

  if (!ready) return <View className="flex-1" style={{ flex: 1, backgroundColor: colors.background }} />;
  return (
    <View className="flex-1" style={{ flex: 1, backgroundColor: colors.background }}>
      {children}
      {enabled && locked ? (
        <View style={[styles.lockOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.lockMark, { backgroundColor: colors.subtleGreen }]}>
            <Feather name="shield" size={25} color={colors.primary} />
          </View>
          <Text style={[styles.lockTitle, { color: colors.foreground }]}>Your money stays yours.</Text>
          <Text style={[styles.lockCopy, { color: colors.mutedForeground }]}>
            Unlock Mira with your device biometrics or passcode.
          </Text>
          <ActionButton title="Unlock Mira" icon="unlock" onPress={() => void unlock()} testID="unlock-app" />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <FinanceProvider>
                <SecurityGate>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                </SecurityGate>
              </FinanceProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  lockOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  lockMark: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  lockTitle: { fontSize: 23, fontWeight: '700', textAlign: 'center' },
  lockCopy: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10, marginBottom: 20, maxWidth: 280 },
});
