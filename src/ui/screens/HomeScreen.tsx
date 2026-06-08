import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Share,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const MOCK_PUBLISHER_ID = 'user-1';
const JOIN_BASE_URL = 'https://followme.app/join';

export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const joinLink = `${JOIN_BASE_URL}/${MOCK_PUBLISHER_ID}`;

  function handleShareLink(): void {
    void Share.share({
      message: `Follow me on Follow Me! You'll receive my photos on WhatsApp: ${joinLink}`,
      url: joinLink,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Follow Me</Text>
        <Text style={styles.subtitle}>Share your moments automatically</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryCard}
          onPress={() => navigation.navigate('Upload')}
        >
          <Text style={styles.cardIcon}>📷</Text>
          <Text style={styles.cardTitle}>Share photos now</Text>
          <Text style={styles.cardDescription}>
            Pick photos from your library and send them to your followers immediately
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={() => navigation.navigate('Config')}
        >
          <Text style={styles.cardIcon}>⚙️</Text>
          <Text style={styles.cardTitle}>Auto-posting settings</Text>
          <Text style={styles.cardDescription}>
            Configure automatic sharing — timing, quantity, and preferences
          </Text>
        </TouchableOpacity>

        <View style={styles.inviteCard}>
          <View style={styles.inviteHeader}>
            <Text style={styles.cardIcon}>🔗</Text>
            <Text style={styles.cardTitle}>Invite followers</Text>
          </View>
          <Text style={styles.cardDescription}>
            Share this link — followers register automatically and receive your photos on WhatsApp
          </Text>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={1}>{joinLink}</Text>
          </View>
          <TouchableOpacity style={styles.shareLink} onPress={handleShareLink}>
            <Text style={styles.shareLinkText}>Share via WhatsApp</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', paddingHorizontal: 24 },
  header: { paddingTop: 48, paddingBottom: 32 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#555', marginTop: 6 },
  actions: { gap: 16 },
  primaryCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  secondaryCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  inviteCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  inviteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  cardIcon: { fontSize: 24, marginBottom: 10 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#fff', marginBottom: 6 },
  cardDescription: { fontSize: 13, color: '#666', lineHeight: 20, marginBottom: 14 },
  linkBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 10,
  },
  linkText: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  shareLink: {
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareLinkText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});