import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { authService } from '../../composition/container';
import { subscribeToAuthDeepLinks } from '../../infrastructure/auth/deepLinkSubscription';

interface AuthState {
  publisherId: string | null;
  publisherPhone: string | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  savePhone: (phone: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Resolves to exp://... in Expo Go and followme://... in a standalone build
const REDIRECT_URL = ExpoLinking.createURL('auth');

function phoneFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const phone = metadata?.whatsapp_phone;
  return typeof phone === 'string' && phone.length > 0 ? phone : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [publisherPhone, setPublisherPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void authService.getSession().then(session => {
      setPublisherId(session?.user.id ?? null);
      setPublisherPhone(phoneFromMetadata(session?.user.user_metadata));
      setLoading(false);
    });

    const unsubscribe = authService.onAuthStateChange((_, session) => {
      setPublisherId(session?.user.id ?? null);
      setPublisherPhone(phoneFromMetadata(session?.user.user_metadata));
      setLoading(false);
    });

    const unsubscribeDeepLinks = subscribeToAuthDeepLinks(Linking, authService);

    return () => {
      unsubscribe();
      unsubscribeDeepLinks();
    };
  }, []);

  async function signIn(email: string): Promise<void> {
    await authService.signInWithOtp(email, REDIRECT_URL);
  }

  async function signOut(): Promise<void> {
    await authService.signOut();
  }

  async function savePhone(phone: string): Promise<void> {
    await authService.updateUserPhone(phone);
    setPublisherPhone(phone);
  }

  return (
    <AuthContext.Provider value={{ publisherId, publisherPhone, loading, signIn, signOut, savePhone }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx == null) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function usePublisherId(): string {
  const { publisherId } = useAuth();
  if (publisherId == null) throw new Error('usePublisherId called before authentication');
  return publisherId;
}
