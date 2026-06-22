import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService } from '../../composition/container';

interface AuthState {
  publisherId: string | null;
  publisherPhone: string | null;
  loading: boolean;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [publisherPhone, setPublisherPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void authService.getSession().then(session => {
      setPublisherId(session?.user.id ?? null);
      setPublisherPhone(session?.user.phone ?? null);
      setLoading(false);
    });

    const unsubscribe = authService.onAuthStateChange((_, session) => {
      setPublisherId(session?.user.id ?? null);
      setPublisherPhone(session?.user.phone ?? null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  async function sendOtp(phone: string): Promise<void> {
    await authService.signInWithPhoneOtp(phone);
  }

  async function verifyOtp(phone: string, token: string): Promise<void> {
    await authService.verifyPhoneOtp(phone, token);
  }

  async function signOut(): Promise<void> {
    await authService.signOut();
  }

  return (
    <AuthContext.Provider value={{ publisherId, publisherPhone, loading, sendOtp, verifyOtp, signOut }}>
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
