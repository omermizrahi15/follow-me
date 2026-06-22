import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type AuthChangeEvent } from '@supabase/supabase-js';

export class SupabaseAuthService {
  private client: ReturnType<typeof createClient>;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

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
