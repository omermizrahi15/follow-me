import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function PhoneSignInScreen(): React.JSX.Element {
  const { sendOtp, verifyOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSendOtp(): void {
    void (async (): Promise<void> => {
      const trimmed = phone.trim();
      if (!isValidE164(trimmed)) {
        setError('Enter a valid number in international format, e.g. +972501234567');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await sendOtp(trimmed);
        setSent(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleVerifyOtp(): void {
    void (async (): Promise<void> => {
      if (!code.trim()) return;
      setLoading(true);
      setError(null);
      try {
        await verifyOtp(phone.trim(), code.trim());
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.inner}
        >
          <View style={styles.header}>
            <Text style={styles.appName}>FOLLOW ME</Text>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.subtitle}>We sent a code to {phone} on WhatsApp</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="123456"
            placeholderTextColor="#444"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCorrect={false}
            onSubmitEditing={handleVerifyOtp}
            returnKeyType="done"
          />

          {error != null && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, (loading || !code.trim()) && styles.disabled]}
            onPress={handleVerifyOtp}
            disabled={loading || !code.trim()}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.buttonText}>Verify</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setSent(false)}>
            <Text style={styles.changeNumber}>Use a different number</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <View style={styles.header}>
          <Text style={styles.appName}>FOLLOW ME</Text>
          <Text style={styles.title}>Your WhatsApp number</Text>
          <Text style={styles.subtitle}>We'll send you a code on WhatsApp to sign in</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="+972501234567"
          placeholderTextColor="#444"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCorrect={false}
          onSubmitEditing={handleSendOtp}
          returnKeyType="done"
        />

        {error != null && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, (loading || !phone.trim()) && styles.disabled]}
          onPress={handleSendOtp}
          disabled={loading || !phone.trim()}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.buttonText}>Send code</Text>
          }
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 40 },
  appName: { fontSize: 11, color: '#444', letterSpacing: 3, marginBottom: 20 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#555' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  button: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#000', fontWeight: '600', fontSize: 15 },
  changeNumber: { color: '#555', fontSize: 13, marginTop: 24, textDecorationLine: 'underline', textAlign: 'center' },
});
