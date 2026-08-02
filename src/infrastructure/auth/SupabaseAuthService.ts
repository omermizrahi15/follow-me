import type { Session, AuthChangeEvent, SupabaseClient } from '@supabase/supabase-js';

export class SupabaseAuthService {
  // The same client the repositories query with, so signing in here is what
  // makes their reads and writes carry the user's JWT (issue #115).
  constructor(private readonly client: SupabaseClient) {}

  async signInWithPhoneOtp(phone: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      phone,
      options: { channel: 'whatsapp' },
    });
    if (error != null) throw new Error(error.message);
  }

  async verifyPhoneOtp(phone: string, token: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error != null) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error != null) throw new Error(error.message);
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    return data.session;
  }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): () => void {
    const { data: { subscription } } = this.client.auth.onAuthStateChange(callback);
    return () => subscription.unsubscribe();
  }
}
