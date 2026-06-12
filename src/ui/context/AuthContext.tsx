import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { authService } from '../../composition/container';
import { handleAuthUrl } from '../../infrastructure/auth/authUrlHandler';

interface AuthState {
  publisherId: string | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Resolves to exp://... in Expo Go and followme://... in a standalone build
const REDIRECT_URL = ExpoLinking.createURL('auth');


export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void authService.getSession().then(session => {
      setPublisherId(session?.user.id ?? null);
      setLoading(false);
    });

    const unsubscribe = authService.onAuthStateChange((_, session) => {
      setPublisherId(session?.user.id ?? null);
      setLoading(false);
    });

    function handleUrl({ url }: { url: string }): void {
      handleAuthUrl(url, authService);
    }

    void Linking.getInitialURL().then(url => {
      if (url != null) handleUrl({ url });
    });

    const sub = Linking.addEventListener('url', handleUrl);
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, []);

  async function signIn(email: string): Promise<void> {
    await authService.signInWithOtp(email, REDIRECT_URL);
  }

  async function signOut(): Promise<void> {
    await authService.signOut();
  }

  return (
    <AuthContext.Provider value={{ publisherId, loading, signIn, signOut }}>
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
