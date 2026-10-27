import { Person } from './People';
import { useEffect, useRef, useState } from 'react';
import { ticketCategories, ticketPriorities, ticketStatuses } from '../../../packages/core/src/ticket-config';
import { PointsDialog } from './PointsDialog';
import { PointsPagination } from './PointsLedger';
import { formatDate, translateError, type Locale, type Values } from './i18n';
type Row = Record<string, unknown>;
type Api = <T = Row>(path: string, method?: string, input?: unknown) => Promise<T>;
type Ticket = Row & { id: string; seq: number; revision: number; status: string; priority: string; assigned_to: string | null; events: { id: string; actor_id: string; action: string; created_at: string; detail: { note?: string } }[]; eventPage: number; eventPageSize: number; eventCount: number; discord_url: string | null; issue_award: { amount: number } | null; replies: { id: string; authored_by: string; body: string; status: string; error_code: string | null }[] };
type Filter = { search: string; status: string; priority: string; category: string; member: string; assigned: string };
const emptyFilter: Filter = { search: '', status: '', priority: '', category: '', member: '', assigned: '' };
export function TicketsPanel({ api, active, refreshKey, locale, t, userId, role }: { api: Api; active: boolean; refreshKey: number; locale: Locale; t: (key: string, values?: Values) => string; userId: string; role: string }) {
  const [filter, setFilter] = useState(emptyFilter);
  const applied = useRef(emptyFilter);
  const [data, setData] = useState<{ entries: Ticket[]; total: number; page: number; pageSize: number } | null>(null);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [edit, setEdit] = useState({ status: 'OPEN', priority: 'NORMAL', assignedTo: '', note: '' });
  const [baseline, setBaseline] = useState('');
  const [version, setVersion] = useState(0);
  const [reviewNote, setReviewNote] = useState('');
  const [reply, setReply] = useState('');
  const [replyKey, setReplyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const dirty = JSON.stringify(edit) !== baseline || reviewNote.trim().length > 0 || reply.trim().length > 0;
  async function load(page = 1, values = applied.current) {
    const id = ++sequence.current;
    const query = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
    const result = await api<NonNullable<typeof data>>(`/tickets/search?${query}`);
    if (id === sequence.current) { setData(result); applied.current = values; }
  }
  async function open(id: string, page = 1, reset = true) {
    const value = await api<Ticket>(`/tickets/${id}?page=${page}`);
    if (detail?.id !== value.id) { setReply(''); setReplyKey(crypto.randomUUID()); }
    setDetail(value);
    if (reset) {
      const fields = { status: value.status, priority: value.priority, assignedTo: value.assigned_to ?? '', note: '' };
      setEdit(fields); setReviewNote(''); setBaseline(JSON.stringify(fields)); setVersion(value.revision);
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { if (active) void load().catch(e => setError((e as Error).message)); return () => { ++sequence.current; }; }, [active, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const messages = <>{error && <p className="error" role="alert">{translateError(locale, error)}</p>}{notice && <p className="notice" role="status">{t(notice)}</p>}</>;
  const manager = role === 'SUPER_ADMIN' || role === 'COMMUNITY_MANAGER';
  return <>
    {!detail && messages}
    <section><div className="section-head"><h2>{t('Support inbox')}</h2><span className="badge">{data?.total ?? 0} {t('visible')}</span></div>
      <form className="ticket-filters" onSubmit={event => { event.preventDefault(); void run(() => load(1, filter)); }}>
        <label>{t('Search ticket number or summary')}<input maxLength={100} value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })}/></label>
        <label>{t('Status')}<select value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value })}><option value="">{t('All statuses')}</option>{[...ticketStatuses, 'FAILED', 'UNKNOWN', 'PROVISIONING'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t('Priority')}<select value={filter.priority} onChange={event => setFilter({ ...filter, priority: event.target.value })}><option value="">{t('All priorities')}</option>{ticketPriorities.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t('Topic')}<select value={filter.category} onChange={event => setFilter({ ...filter, category: event.target.value })}><option value="">{t('All topics')}</option>{ticketCategories.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t('Requester ID')}<input maxLength={30} value={filter.member} onChange={event => setFilter({ ...filter, member: event.target.value.trim() })}/></label>
        <label>{t('Assignee ID filter')}<input maxLength={30} value={filter.assigned} onChange={event => setFilter({ ...filter, assigned: event.target.value.trim() })}/></label>
        <div className="points-filter-actions"><button disabled={busy}>{t('Search tickets')}</button><button type="button" disabled={busy} onClick={() => { setFilter(emptyFilter); void run(() => load(1, emptyFilter)); }}>{t('Clear filters')}</button></div>
      </form>
      {data ? <>{data.entries.length ? <div className="table-scroll"><table><thead><tr>{['Ticket','Summary','Status','Priority','Requester','Owner','Created'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.entries.map(ticket => <tr key={ticket.id}>
        <td><button className="link-button" disabled={busy} onClick={() => void run(() => open(ticket.id))}>#{ticket.seq}</button></td><td>{String(ticket.summary)}</td><td>{t(ticket.status)}</td><td>{t(ticket.priority)}</td><td><Person id={ticket.creator_id}/></td><td><Person id={ticket.assigned_to}/></td><td>{formatDate(locale, ticket.created_at)}</td>
      </tr>)}</tbody></table></div> : <div className="empty">{t('No tickets yet.')}<small>{t('Use /ticket or the help-desk panel to open a private support request.')}</small></div>}<PointsPagination data={data} busy={busy} load={page => { void run(() => load(page)); }} t={t}/></> : <p>{t('Loading…')}</p>}
    </section>
    {detail && <PointsDialog title={`${t('Ticket #')}${detail.seq} · ${detail.summary}`} closeLabel={t('Close')} onClose={() => { if (!dirty || window.confirm(t('Discard unsaved ticket changes?'))) { setDetail(null); setError(''); setNotice(''); } }}>
      {messages}<p>{t("Requester")}: <Person id={detail.creator_id}/></p><p className="prewrap">{String(detail.description)}</p>{!!detail.environment && <p>{t('Device / environment')}: {String(detail.environment)}</p>}
      <p>{t('Status')}: <strong>{t(detail.status)}</strong> · {t('Priority')}: {t(detail.priority)}</p>
      <p className="muted">{t('Discord synchronization')}: {t(String(detail.sync_status))}{detail.sync_error ? ` · ${translateError(locale, String(detail.sync_error))}` : ''}</p>
      {detail.discord_url && <a className="button" href={detail.discord_url} target="_blank" rel="noreferrer">{t('Open private Discord conversation')}</a>}
      <button disabled={busy} onClick={() => { if (!dirty || window.confirm(t('Discard unsaved ticket changes?'))) void run(() => open(detail.id)); }}>{t('Refresh ticket')}</button>
      {['RETRY','FAILED'].includes(String(detail.sync_status)) && ticketStatuses.some(status => status === detail.status) && <button disabled={busy} onClick={() => void run(async () => { await api(`/tickets/${detail.id}/retry-sync`, 'POST', {}); await open(detail.id, detail.eventPage, false); setNotice('Ticket synchronization queued.'); })}>{t('Retry Discord synchronization')}</button>}
      {detail.revision !== version && <p className="error">{t('This ticket changed elsewhere. Your edits are preserved; refresh before saving.')}</p>}
      {manager && ['FAILED','UNKNOWN'].includes(detail.status) && <section className="ticket-recovery"><p>{t('Check Discord for any created channel before closing this failed or uncertain record. Nothing is automatically recreated or deleted.')}</p><label>{t('Manual recovery review')}<textarea minLength={10} maxLength={1000} value={reviewNote} onChange={event => setReviewNote(event.target.value)}/></label><button disabled={busy || reviewNote.trim().length < 10} onClick={() => {
        if (!window.confirm(t('Have you checked and handled any existing Discord channel? Close this record after manual review?'))) return;
        void run(async () => { await api(`/tickets/${detail.id}/provision-reviewed`, 'POST', { note: reviewNote, expectedVersion: detail.revision, confirm: true }); await open(detail.id); await load(); setNotice('Provisioning review recorded. A new request may be submitted within the normal limits.'); });
      }}>{t('Close reviewed failed record')}</button></section>}
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        await api(`/tickets/${detail.id}`, 'PATCH', { status: edit.status, priority: edit.priority, assignedTo: edit.assignedTo || null, note: edit.note, expectedVersion: version });
        await open(detail.id); await load(data?.page ?? 1); setNotice('Ticket updated. Discord synchronization is queued; internal notes stay private.');
      }); }}><fieldset disabled={busy || !ticketStatuses.some(status => status === detail.status)} style={{ border: 0, padding: 0, minWidth: 0 }}><div className="form-grid">
        <label>{t('Status')}<select value={edit.status} onChange={event => setEdit({ ...edit, status: event.target.value })}>{ticketStatuses.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t('Priority')}<select value={edit.priority} onChange={event => setEdit({ ...edit, priority: event.target.value })}>{ticketPriorities.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
        <label>{t('Assignee Discord user ID')}<input disabled={role === 'SUPPORT'} maxLength={30} value={edit.assignedTo} onChange={event => setEdit({ ...edit, assignedTo: event.target.value.trim() })}/><Person id={edit.assignedTo}/></label>
      </div><label>{t('Reason / internal note')}<textarea required minLength={3} maxLength={1000} value={edit.note} onChange={event => setEdit({ ...edit, note: event.target.value })}/></label><p className="muted">{t('Internal notes are visible only to authorized staff in this console. They are never posted in the user’s channel.')}</p>
        <button disabled={busy || !dirty || edit.note.trim().length < 3 || detail.revision !== version}>{t('Save status & note')}</button>
        <button type="button" disabled={busy || dirty || !!detail.assigned_to && detail.assigned_to !== userId || role === 'SUPPORT' && detail.assigned_to !== userId} onClick={() => void run(async () => { await api(`/tickets/${detail.id}`, 'PATCH', { status: 'INVESTIGATING', assignedTo: userId, note: 'Claimed for investigation', expectedVersion: version }); await open(detail.id); await load(data?.page ?? 1); setNotice('Ticket updated. Discord synchronization is queued; internal notes stay private.'); })}>{t('Claim ticket')}</button>
      </fieldset></form>
      {manager && ['Bug','Feature Request'].includes(String(detail.category)) && <div className="ticket-award"><p>{detail.issue_award ? t('Issue points already recorded: {points}', { points: detail.issue_award.amount }) : t('Confirm a valid, unique report before awarding issue points. Use the internal note as the review reason.')}</p><button disabled={busy || !!detail.issue_award || edit.note.trim().length < 5 || edit.status !== detail.status || edit.priority !== detail.priority || edit.assignedTo !== (detail.assigned_to ?? '')} onClick={() => {
        if (!window.confirm(t('Confirm this report is valid and unique, and award the published issue points?'))) return;
        void run(async () => { const result = await api(`/tickets/${detail.id}/award`, 'POST', { reason: edit.note, confirm: true }); if (!result.awarded) throw new Error(String(result.reason)); await open(detail.id); setNotice('Issue points awarded once and recorded in the ledger.'); });
      }}>{t('Confirm unique issue & award points')}</button></div>}
      <section className="ticket-public-reply"><h3>{t('Reply to requester')}</h3><p className="muted">{t('This message is sent to the private Discord channel and is visible to the requester. It is separate from internal notes.')}</p><form onSubmit={event => {
        event.preventDefault(); if (!window.confirm(t('Send this reply to the requester in their private Discord channel?'))) return;
        void run(async () => { await api(`/tickets/${detail.id}/reply`, 'POST', { body: reply, requestKey: replyKey }); setReply(''); setReplyKey(crypto.randomUUID()); await open(detail.id, detail.eventPage, false); setNotice('Reply queued. Refresh to check delivery; uncertain results require manual verification.'); });
      }}><label>{t('User-visible reply')}<textarea required maxLength={1900} value={reply} onChange={event => setReply(event.target.value)}/></label><button disabled={busy || !reply.trim() || detail.status === 'CLOSED'}>{t('Send reply')}</button></form>
      {detail.replies.map(item => <article className="ticket-event" key={item.id}><strong>{t(item.status)}</strong><small><Person id={item.authored_by}/></small>{item.error_code && <small>{translateError(locale, item.error_code)}</small>}<p className="prewrap">{item.body}</p></article>)}</section>
      <h3>{t('History')}</h3>{detail.events.map(event => <article className="ticket-event" key={event.id}><strong>{t(event.action)}</strong><small>{formatDate(locale, event.created_at)} · <Person id={event.actor_id}/></small><p className="prewrap">{event.detail.note ?? ''}</p></article>)}
      <PointsPagination data={{ page: detail.eventPage, pageSize: detail.eventPageSize, total: detail.eventCount }} busy={busy} load={page => { void run(() => open(detail.id, page, false)); }} t={t}/>
    </PointsDialog>}
  </>;
}
