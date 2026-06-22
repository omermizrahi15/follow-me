import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Follow Me</Text>
          <TouchableOpacity onPress={() => void signOut()}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
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
          onPress={() => navigation.navigate('Subscribers')}
        >
          <Text style={styles.cardIcon}>👥</Text>
          <Text style={styles.cardTitle}>Your followers</Text>
          <Text style={styles.cardDescription}>
            See who's following you, invite more, or remove anyone who should no longer receive your photos
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', paddingHorizontal: 24 },
  header: { paddingTop: 48, paddingBottom: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  signOut: { fontSize: 13, color: '#555' },
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
  cardIcon: { fontSize: 24, marginBottom: 10 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#fff', marginBottom: 6 },
  cardDescription: { fontSize: 13, color: '#666', lineHeight: 20 },
});