import { useEffect, useState } from 'react';
import { supabase } from '../../infrastructure/supabase/client';

export function usePublisherId(): string | null {
  const [publisherId, setPublisherId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setPublisherId(data.session?.user.id ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setPublisherId(session?.user.id ?? null);
    });

    return () => { listener.subscription.unsubscribe(); };
  }, []);

  return publisherId;
}
