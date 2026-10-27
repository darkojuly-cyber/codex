import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
type Profile = { display_name: string | null; username: string | null };
type Api = <T>(path: string, method?: string, input?: unknown) => Promise<T>;
const Directory = createContext<{ profiles: Record<string, Profile>; resolve: (id: string) => void }>({ profiles: {}, resolve: () => undefined });
export function PeopleProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const pending = useRef(new Set<string>());
  const queue = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { const queued = queue.current; const waiting = pending.current; alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); timer.current = undefined; queued.clear(); waiting.clear(); }; }, []);
  async function flush() {
    timer.current = undefined;
    const members = [...queue.current].slice(0, 30); members.forEach(id => queue.current.delete(id));
    try {
      const result = await api<{ entries: (Profile & { user_id: string })[] }>('/members/resolve', 'POST', { ids: members });
      if (alive.current) setProfiles(value => ({ ...value, ...Object.fromEntries(result.entries.map(profile => [profile.user_id, profile])) }));
    } catch { /* IDs remain visible when nickname lookup is temporarily unavailable. */ }
    if (alive.current && queue.current.size && !timer.current) timer.current = setTimeout(() => void flush(), 20);
  }
  function resolve(id: string) {
    if (!/^\d{17,20}$/.test(id) || profiles[id] || pending.current.has(id)) return;
    pending.current.add(id); queue.current.add(id);
    if (!timer.current) timer.current = setTimeout(() => void flush(), 20);
  }
  return <Directory.Provider value={{ profiles, resolve }}>{children}</Directory.Provider>;
}
export function Person({ id }: { id: unknown }) {
  const user = id == null ? '' : String(id);
  const { profiles, resolve } = useContext(Directory);
  useEffect(() => { if (user) resolve(user); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const profile = profiles[user];
  return <span className="person" title={profile?.username ? `@${profile.username} · ${user}` : user}>{profile?.display_name ? <><span>{profile.display_name}</span><small>{user}</small></> : user || '—'}</span>;
}
