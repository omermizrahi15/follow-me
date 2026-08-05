import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';

export class SupabaseAuthService {
  /**
   * The shared client from `infrastructure/supabase/client` — the same instance
   * the repositories query through, so signing in here immediately authenticates
   * their requests too (issue #115).
   */
  constructor(private readonly client: AppSupabaseClient) {}

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
