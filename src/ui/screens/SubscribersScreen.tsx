import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePublisherId } from '../context/AuthContext';
import { useSubscribers } from '../hooks/useSubscribers';
import type { SubscriberDto } from '../../application/dtos';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

// Points at the deployed Supabase `join` edge function — opening this link
// shows the follower a "Subscribe on WhatsApp" page. Built from the project URL
// so there's no separate domain to maintain.
const JOIN_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/join`;

export function SubscribersScreen({ navigation }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const { subscribers, loading, error, remove } = useSubscribers(publisherId);
  const joinLink = publisherId ? `${JOIN_BASE_URL}/${publisherId}` : null;

  function handleShareLink(): void {
    if (!joinLink) return;
    // Note: only pass `message` (link inline). Passing `url` too makes iOS
    // attach the link as a separate NSURL item, which targets like WhatsApp
    // serialize as a binary plist (bplist00...) instead of plain text.
    void Share.share({
      message: `Follow me on Follow Me! You'll receive my photos on WhatsApp: ${joinLink}`,
    });
  }

  function confirmRemove(subscriber: SubscriberDto): void {
    Alert.alert(
      'Remove follower',
      `${subscriber.contactHandle} will stop receiving your photos. You can re-add them later with your invite link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void remove(subscriber.id).catch(() => {
              Alert.alert('Could not remove follower', 'Please try again.');
            });
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Your followers</Text>
          <Text style={styles.subtitle}>
            {subscribers.length === 0
              ? 'People who follow you will receive your photos on WhatsApp'
              : `${subscribers.length} ${subscribers.length === 1 ? 'person follows' : 'people follow'} you`}
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : error != null ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : subscribers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>👋</Text>
            <Text style={styles.emptyTitle}>No followers yet</Text>
            <Text style={styles.emptyDescription}>
              Share your invite link to start building your audience.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {subscribers.map(subscriber => (
              <View key={subscriber.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowHandle}>{subscriber.contactHandle}</Text>
                  <Text style={styles.rowStatus}>Active</Text>
                </View>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => confirmRemove(subscriber)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Add more */}
        <View style={styles.inviteSection}>
          <Text style={styles.sectionTitle}>Add more followers</Text>
          <Text style={styles.hint}>
            Share this link — people register automatically and start receiving your photos on WhatsApp.
          </Text>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={1}>
              {joinLink ?? 'Sign in to get your link'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.shareLink, !joinLink && styles.shareLinkDisabled]}
            onPress={handleShareLink}
            disabled={!joinLink}
          >
            <Text style={styles.shareLinkText}>Share invite link</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', paddingHorizontal: 24 },
  header: { paddingTop: 24, paddingBottom: 24 },
  back: { color: '#555', fontSize: 14, marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#555', marginTop: 6 },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorText: { color: '#e0564f', fontSize: 14, textAlign: 'center' },
  emptyState: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    marginBottom: 16,
  },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 6 },
  emptyDescription: { fontSize: 13, color: '#666', textAlign: 'center', lineHeight: 20 },
  list: { gap: 10, marginBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#222',
  },
  rowInfo: { flex: 1, marginRight: 12 },
  rowHandle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  rowStatus: { color: '#25D366', fontSize: 12, marginTop: 4 },
  removeButton: {
    backgroundColor: '#2a1414',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#3d1f1f',
  },
  removeButtonText: { color: '#e0564f', fontSize: 13, fontWeight: '600' },
  inviteSection: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 12 },
  hint: { color: '#444', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  linkBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  linkText: { color: '#888', fontSize: 13, fontFamily: 'monospace' },
  shareLink: {
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  shareLinkDisabled: { backgroundColor: '#1a3d2a', opacity: 0.5 },
  shareLinkText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
