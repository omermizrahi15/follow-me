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

export function SignInScreen(): React.JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSend(): void {
    void (async (): Promise<void> => {
      if (!email.trim()) return;
      setLoading(true);
      setError(null);
      try {
        await signIn(email.trim().toLowerCase());
        setSent(true);
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
        <View style={styles.center}>
          <Text style={styles.sentIcon}>✉</Text>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a magic link to {email}.{'\n'}Tap it to sign in.
          </Text>
          <TouchableOpacity onPress={() => setSent(false)}>
            <Text style={styles.changeEmail}>Use a different email</Text>
          </TouchableOpacity>
        </View>
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
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>We'll send a magic link to your email</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="your@email.com"
          placeholderTextColor="#444"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />

        {error != null && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, (loading || !email.trim()) && styles.disabled]}
          onPress={handleSend}
          disabled={loading || !email.trim()}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.buttonText}>Send magic link</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  sentIcon: { fontSize: 48, color: '#fff', marginBottom: 24 },
  changeEmail: { color: '#555', fontSize: 13, marginTop: 24, textDecorationLine: 'underline' },
});
