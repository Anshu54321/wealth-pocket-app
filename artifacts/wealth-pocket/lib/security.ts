import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DATABASE_KEY = 'mira.database.key.v1';
const GMAIL_TOKEN = 'mira.gmail.access-token.v1';
const GMAIL_EXPIRY = 'mira.gmail.expiry.v1';
const BIOMETRIC_ENABLED = 'mira.biometric.enabled.v1';

async function getSecureValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function setSecureValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteSecureValue(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getOrCreateDatabaseKey(): Promise<string> {
  const existing = await getSecureValue(DATABASE_KEY);
  if (existing && /^[a-f0-9]{64}$/i.test(existing)) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await setSecureValue(DATABASE_KEY, key);
  return key;
}

export async function storeGmailToken(token: string, expiresAt: number): Promise<void> {
  await setSecureValue(GMAIL_TOKEN, token);
  await setSecureValue(GMAIL_EXPIRY, String(expiresAt));
}

export async function readGmailToken(): Promise<{ token: string; expiresAt: number } | null> {
  const [token, expiry] = await Promise.all([
    getSecureValue(GMAIL_TOKEN),
    getSecureValue(GMAIL_EXPIRY),
  ]);
  if (!token) return null;
  return { token, expiresAt: Number(expiry ?? 0) };
}

export async function forgetGmailToken(): Promise<void> {
  await Promise.all([deleteSecureValue(GMAIL_TOKEN), deleteSecureValue(GMAIL_EXPIRY)]);
}

export async function getBiometricEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BIOMETRIC_ENABLED)) === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_ENABLED, String(enabled));
}