import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { authService } from '../../composition/container';

interface AuthState {
  publisherId: string | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const REDIRECT_URL = 'followme://auth';

function parseHashParams(url: string): Record<string, string> {
  const hash = url.split('#')[1] ?? '';
  const result: Record<string, string> = {};
  hash.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) result[k] = decodeURIComponent(v);
  });
  return result;
}

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
      const params = parseHashParams(url);
      if (params.access_token != null && params.refresh_token != null) {
        void authService.setSession(params.access_token, params.refresh_token);
      }
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
