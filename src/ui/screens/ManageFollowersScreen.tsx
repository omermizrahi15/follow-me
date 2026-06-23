import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, radius, spacing, typography } from '../theme/theme';

type FollowerStatus = 'pending' | 'active' | 'revoked';

interface FollowerStub {
  id: string;
  name: string;
  handle: string;
  avatarUri: string;
  status: FollowerStatus;
}

/** Mock followers — real data + actions tracked in issue #36. */
const FOLLOWER_STUBS: FollowerStub[] = [
  { id: 'f1', name: 'Maya Cohen', handle: '+972 50 123 4567', avatarUri: 'https://i.pravatar.cc/200?img=47', status: 'active' },
  { id: 'f2', name: 'Daniel Levi', handle: '+972 52 987 6543', avatarUri: 'https://i.pravatar.cc/200?img=33', status: 'active' },
  { id: 'f3', name: 'Noa Bar', handle: '+972 54 555 0199', avatarUri: 'https://i.pravatar.cc/200?img=45', status: 'pending' },
  { id: 'f4', name: 'Itai Shapira', handle: '+972 53 222 8810', avatarUri: 'https://i.pravatar.cc/200?img=15', status: 'active' },
  { id: 'f5', name: 'Tamar Gold', handle: '+972 50 661 2042', avatarUri: 'https://i.pravatar.cc/200?img=49', status: 'pending' },
  { id: 'f6', name: 'Omer Katz', handle: '+972 58 909 7723', avatarUri: 'https://i.pravatar.cc/200?img=68', status: 'active' },
];

export function ManageFollowersScreen(): React.JSX.Element {
  const [followers, setFollowers] = useState(FOLLOWER_STUBS);

  function setStatus(id: string, status: FollowerStatus): void {
    setFollowers(prev => prev.map(f => (f.id === id ? { ...f, status } : f)));
  }

  const pending = followers.filter(f => f.status === 'pending');
  const others = followers.filter(f => f.status !== 'pending');
  const activeCount = followers.filter(f => f.status === 'active').length;

  function renderRow(f: FollowerStub): React.JSX.Element {
    return (
      <View key={f.id} style={styles.card}>
        <Image source={{ uri: f.avatarUri }} style={styles.avatar} />
        <View style={styles.info}>
          <Text style={styles.name}>{f.name}</Text>
          <Text style={styles.handle}>{f.handle}</Text>
        </View>
        {f.status === 'pending' ? (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.declineBtn} onPress={() => setStatus(f.id, 'revoked')}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveBtn} onPress={() => setStatus(f.id, 'active')}>
              <Ionicons name="checkmark" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.statusPill, f.status === 'active' ? styles.activePill : styles.revokedPill]}
            onPress={() => setStatus(f.id, f.status === 'active' ? 'revoked' : 'active')}
          >
            <Text style={[styles.statusText, f.status === 'active' ? styles.activeText : styles.revokedText]}>
              {f.status === 'active' ? 'Active' : 'Revoked'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Followers" showBack={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.summary}>{activeCount} active follower{activeCount === 1 ? '' : 's'}</Text>

        {pending.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Pending requests</Text>
            {pending.map(renderRow)}
          </>
        )}

        <Text style={styles.sectionLabel}>Followers</Text>
        {others.map(renderRow)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 120 },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  info: { flex: 1 },
  name: { ...typography.body, fontSize: 15, fontWeight: '600', color: colors.text },
  handle: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  declineBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  approveBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  activePill: { backgroundColor: colors.accentSoft },
  revokedPill: { backgroundColor: colors.surfaceAlt },
  statusText: { fontSize: 12, fontWeight: '600' },
  activeText: { color: colors.accentDark },
  revokedText: { color: colors.textSecondary },
});
