import { useEffect, useRef, useState } from 'react';
import { xpEvents } from '../../../packages/core/src/xp-config';
import { formatDate, translateError, type Locale, type Values } from './i18n';
import { PointsDialog } from './PointsDialog';

type Row = Record<string, unknown>;
export type PointsApi = <T = Row>(path: string, method?: string, input?: unknown) => Promise<T>;
type T = (key: string, values?: Values) => string;
type Page = { entries: Row[]; total: number; page: number; pageSize: number; timezone: string };
type Filter = { memberId: string; event: string; from: string; to: string };
const emptyFilter: Filter = { memberId: '', event: '', from: '', to: '' };

export function LedgerTable({ entries, locale, t, onMember, timezone }: { timezone?: string; entries: Row[]; locale: Locale; t: T; onMember?: (id: string) => void }) {
  return <div className="table-scroll points-ledger-table"><table><thead><tr>{['Date','Member','XP','Source','Reason','Rule version','Operator'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{entries.map(row => <tr key={String(row.id)}>
    <td>{timezone ? new Date(String(row.occurred_at)).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { timeZone: timezone }) : formatDate(locale, row.occurred_at)}</td><td>{onMember ? <button className="link-button" onClick={() => onMember(String(row.user_id))}>{String(row.user_id)}</button> : String(row.user_id)}</td>
    <td>{Number(row.amount) > 0 ? '+' : ''}{String(row.amount)}</td><td>{String(row.source_key)}</td><td>{String(row.reason)}</td><td>v{String(row.rule_version)}</td><td>{String(row.actor_id)}</td>
  </tr>)}</tbody></table></div>;
}
export function PointsPagination({ data, busy, load, t }: { data: { page: number; pageSize: number; total: number }; busy: boolean; load: (page: number) => void; t: T }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="points-pagination"><button disabled={busy || data.page <= 1} onClick={() => load(data.page - 1)}>{t('Previous page')}</button><span>{t('Page {page} of {pages} · {total} records', { page: data.page, pages, total: data.total })}</span><button disabled={busy || data.page >= pages} onClick={() => load(data.page + 1)}>{t('Next page')}</button></div>;
}
export function PointsLedger({ api, refreshKey, locale, t, onMember }: { api: PointsApi; refreshKey: number; locale: Locale; t: T; onMember: (id: string) => void }) {
  const [filter, setFilter] = useState(emptyFilter);
  const applied = useRef(emptyFilter);
  const [data, setData] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  async function load(page = 1, filters = applied.current) {
    const id = ++requestId.current;
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ page: String(page) });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      const result = await api<Page>(`/xp/ledger?${query}`);
      if (id === requestId.current) { applied.current = filters; setData(result); }
    } catch (e) { if (id === requestId.current) setError((e as Error).message); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { ++requestId.current; }; }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section><h2>{t('XP ledger')}</h2><p className="muted">{t('Search all points records. Dates use the published rules timezone. Click a member to inspect their account.')}{data && ` ${data.timezone}`}</p>
    <form className="points-filters" onSubmit={event => { event.preventDefault(); void load(1, filter); }}>
      <label>{t('Member ID filter')}<input pattern="[0-9]{17,20}" value={filter.memberId} onChange={event => setFilter({ ...filter, memberId: event.target.value.trim() })}/></label>
      <label>{t('Points type')}<select value={filter.event} onChange={event => setFilter({ ...filter, event: event.target.value })}><option value="">{t('All types')}</option>{[...xpEvents, 'manual'].map(event => <option key={event} value={event}>{t(`xp.event.${event}`)}</option>)}</select></label>
      <label>{t('From date')}<input type="date" value={filter.from} onChange={event => setFilter({ ...filter, from: event.target.value })}/></label><label>{t('To date')}<input type="date" value={filter.to} onChange={event => setFilter({ ...filter, to: event.target.value })}/></label>
      <div className="points-filter-actions"><button disabled={busy}>{t('Search points')}</button><button type="button" disabled={busy || !/^\d{17,20}$/.test(filter.memberId)} onClick={() => onMember(filter.memberId)}>{t('View member summary')}</button><button type="button" disabled={busy} onClick={() => { setFilter(emptyFilter); void load(1, emptyFilter); }}>{t('Clear filters')}</button></div>
    </form>
    {error && <p className="error" role="alert">{translateError(locale, error)}</p>}
    {data ? <><LedgerTable timezone={data.timezone} entries={data.entries} locale={locale} t={t} onMember={onMember}/>{data.entries.length === 0 && <p>{t('No matching points records.')}</p>}<PointsPagination data={data} busy={busy} load={page => { void load(page); }} t={t}/></> : <p>{t('Loading…')}</p>}
  </section>;
}
type MemberData = { userId: string; summary: { lifetimeXp: number; periodXp: Record<string, number>; ranks: Record<string, number | null>; eligible: boolean; rankEligible: boolean; timezone: string }; ledger: Page };
export function PointsMemberDialog({ userId, api, locale, t, onClose }: { userId: string; api: PointsApi; locale: Locale; t: T; onClose: () => void }) {
  const [data, setData] = useState<MemberData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  async function load(page = 1) {
    const id = ++requestId.current;
    setBusy(true); setError('');
    try { const value = await api<MemberData>(`/xp/members/${userId}?page=${page}`); if (id === requestId.current) setData(value); }
    catch (e) { if (id === requestId.current) setError((e as Error).message); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  useEffect(() => { setData(null); void load(); return () => { ++requestId.current; }; }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PointsDialog title={t('Member points summary')} closeLabel={t('Close')} onClose={onClose}><p><strong>{t('Member')}: {userId}</strong></p>{error && <p className="error" role="alert">{translateError(locale, error)}</p>}
    {data ? <><p>{t(!data.summary.eligible ? 'Excluded from the points activity' : data.summary.rankEligible ? 'Earning and ranking enabled' : 'Earning enabled · excluded from rankings')}</p><div className="points-member-stats">
      {[['Total points', data.summary.lifetimeXp], ['Points this week', data.summary.periodXp.weekly], ['Points this month', data.summary.periodXp.monthly]].map(([label, value]) => <article key={label}><small>{t(String(label))}</small><strong>{value}</strong></article>)}
    </div><p>{t('Weekly rank')}: {data.summary.ranks.weekly ? `#${data.summary.ranks.weekly}` : '—'} · {t('Monthly rank')}: {data.summary.ranks.monthly ? `#${data.summary.ranks.monthly}` : '—'} · {t('Overall rank')}: {data.summary.ranks.all_time ? `#${data.summary.ranks.all_time}` : '—'}</p><p className="muted">{data.summary.timezone}</p>
      <LedgerTable timezone={data.summary.timezone} entries={data.ledger.entries} locale={locale} t={t}/>{data.ledger.entries.length === 0 && <p>{t('No matching points records.')}</p>}<PointsPagination data={data.ledger} busy={busy} load={page => { void load(page); }} t={t}/></> : <p>{t('Loading…')}</p>}
  </PointsDialog>;
}
