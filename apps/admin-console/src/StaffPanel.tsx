import { useEffect, useState } from 'react';
import { Person } from './People';
import { roleName, translateError, type Locale } from './i18n';
type Grant = { user_id: string; role: string; revoked: boolean; revision: number; updated_by: string };
type Data = { entries: Grant[]; roots: string[]; inheritedRoles: Record<string, string[]> };
type Api = <T>(path: string, method?: string, input?: unknown) => Promise<T>;
export function StaffPanel({ api, locale, t }: { api: Api; locale: Locale; t: (key: string) => string }) {
  const [data, setData] = useState<Data | null>(null);
  const [user, setUser] = useState(''); const [role, setRole] = useState('SUPPORT'); const [revoked, setRevoked] = useState(false); const [reason, setReason] = useState(''); const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function load() { setData(await api<Data>('/staff')); }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <section><h2>{t('Staff access')}</h2><p>{t('Only super admins can authorize staff. Changes revoke existing sessions and take effect on the next sign-in. Server membership is always required.')}</p>
    {error && <p role="alert" className="error">{translateError(locale, error)}</p>}{notice && <p role="status">{t(notice)}</p>}
    <div className="table-scroll"><table><thead><tr><th>{t('Role')}</th><th>{t('Allowed operations')}</th></tr></thead><tbody>{[
      ['SUPER_ADMIN','All operations, staff authorization and monitoring settings'],
      ['COMMUNITY_MANAGER','Configuration, publishing, messages, points, all tickets, reports and risk review'],
      ['MODERATOR','All tickets, reports, risk review and audit; no publishing or points adjustments'],
      ['SUPPORT','Own or assigned tickets only; no configuration, reports or points management'],
    ].map(([name, description]) => <tr key={name}><td>{roleName(locale, name)}</td><td>{t(description)}</td></tr>)}</tbody></table></div>
    <form onSubmit={event => { event.preventDefault(); if (!window.confirm(t('Apply this staff authorization and sign the member out of existing console sessions?'))) return; setBusy(true); setError(''); setNotice(''); void api(`/staff/${user}`, 'PUT', { role, revoked, expectedVersion: version, reason }).then(async () => { await load(); setUser(''); setReason(''); setVersion(0); setNotice('Staff authorization saved.'); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>
      <div className="form-grid"><label>{t('Staff Discord user ID')}<input required pattern="[0-9]{17,20}" value={user} onChange={event => { const id = event.target.value.trim(); setUser(id); const existing = data?.entries.find(row => row.user_id === id); setVersion(existing?.revision ?? 0); setRole(existing?.role ?? 'SUPPORT'); setRevoked(existing?.revoked ?? false); }}/><Person id={user}/></label>
      <label>{t('Authorized role')}<select value={role} onChange={event => setRole(event.target.value)}>{['COMMUNITY_MANAGER','MODERATOR','SUPPORT'].map(value => <option key={value} value={value}>{roleName(locale, value)}</option>)}</select></label></div>
      <label className="checkbox"><input type="checkbox" checked={revoked} onChange={event => setRevoked(event.target.checked)}/>{t('Revoke console access')}</label><label>{t('Authorization reason')}<input required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label><button disabled={busy}>{t('Save staff authorization')}</button>
    </form>
    {data?.entries.map(row => <article className="revision" key={row.user_id}><div><Person id={row.user_id}/><p>{roleName(locale, row.role)} · {t(row.revoked ? 'Access revoked' : 'Authorized')}</p><small>{t('Operator')}: <Person id={row.updated_by}/></small></div><button disabled={busy} onClick={() => { setUser(row.user_id); setRole(row.role); setRevoked(row.revoked); setVersion(row.revision); }}>{t('Edit authorization')}</button></article>)}
    <details className="points-tools"><summary>{t('Deployment role bindings')}</summary><p>{t('Members matching these Discord roles inherit the listed access unless individually overridden. Super admins remain protected in deployment settings.')}</p>{data?.roots.map(id => <p key={id}>{t('SUPER_ADMIN')}: <Person id={id}/></p>)}{Object.entries(data?.inheritedRoles ?? {}).map(([name, roles]) => <p key={name}>{roleName(locale, name)}: {roles.join(', ') || '—'}</p>)}</details>
  </section>;
}
