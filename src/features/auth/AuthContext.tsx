import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

export type AppRole = 'admin' | 'manager' | 'front' | 'kitchen';

export interface AppMember {
  user_id: string;
  email: string | null;
  display_name: string;
  role: AppRole;
  active: boolean;
}

interface AuthState {
  configured: boolean;
  loading: boolean;
  memberLoading: boolean;
  session: Session | null;
  member: AppMember | null;
  memberError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<AppMember | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setMemberError(error.message);
      setSession(data.session);
      setMemberLoading(Boolean(data.session));
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setMember(null);
      setMemberLoading(Boolean(nextSession));
      setMemberError(null);
      setLoading(false);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) {
      setMember(null);
      setMemberLoading(false);
      return;
    }
    let alive = true;
    setMemberLoading(true);
    void supabase
      .from('app_members')
      .select('user_id, email, display_name, role, active')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        setMember(data as AppMember | null);
        setMemberError(error?.message ?? null);
        setMemberLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      memberLoading,
      session,
      member,
      memberError,
      signOut: async () => {
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [loading, memberLoading, session, member, memberError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
