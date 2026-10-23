import { useEffect, useState } from 'react';
import { xpDefaults, xpEvents, type XpConfig, type XpRule, type XpPeriod } from '../../../packages/core/src/xp-config';
import { translateError, formatDate, type Locale, type Values } from './i18n';

type Row = Record<string, unknown>;
type Revision = { id: string; version: number; status: string; body: XpConfig; reason: string; authored_by: string; approved_by: string | null };
type Overview = { current: Revision; revisions: Revision[]; ledger: Row[]; boosts: Row[] };
type Api = <T = Row>(path: string, method?: string, input?: unknown) => Promise<T>;
export function PointsPanel({ api, active, refreshKey, locale, t }: { api: Api; active: boolean; refreshKey: number; locale: Locale; t: (key: string, values?: Values) => string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [config, setConfig] = useState<XpConfig | null>(null);
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [addEvent, setAddEvent] = useState('chat');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState(10);
  const [adjustReason, setAdjustReason] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [event, setEvent] = useState('creation');
  const [source, setSource] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [period, setPeriod] = useState<XpPeriod>('weekly');
  const [board, setBoard] = useState<Row[]>([]);
  function edit(value: XpConfig) {
    setConfig(structuredClone(value));
    setChannels(Object.fromEntries(value.rules.map(rule => [rule.event, rule.channels.join(', ')])));
  }
  async function load(reset = false) {
    const result = await api<Overview>('/xp/config');
    setOverview(result);
    if (reset || !config) edit(result.current.body);
  }
  useEffect(() => { if (active) void load().catch(e => setError((e as Error).message)); }, [active, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function ruleChange(index: number, patch: Partial<XpRule>) {
    if (!config) return;
    setConfig({ ...config, rules: config.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
  }
  if (!config || !overview) return <section><h2>{t('XP & Rewards')}</h2>{error ? <p role="alert">{translateError(locale, error)}</p> : <p>{t('Loading…')}</p>}</section>;
  return <>
    {error && <p className="error" role="alert">{translateError(locale, error)}</p>}
    {notice && <p className="notice" role="status">{t(notice)}</p>}
    <section><h2>{t('XP & Rewards')}</h2><p>{t('Published XP rules v{version}', { version: overview.current.version })} · <strong>{t(overview.current.body.enabled ? 'Scoring enabled' : 'Scoring disabled')}</strong></p><p className="muted">{t('Values below are proposals until reviewed and published. Changes apply to new events; previous awards stay in the ledger.')}</p>
      <label className="checkbox"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })}/>{t('Enable XP scoring')}</label>
      <div className="form-grid"><label>{t('XP timezone')}<input value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })}/></label>
      <label>{t('Minimum meaningful characters')}<input type="number" min={5} max={200} value={config.minimumCharacters} onChange={e => setConfig({ ...config, minimumCharacters: Number(e.target.value) })}/></label>
      <label>{t('Level thresholds (comma separated, starts at 0)')}<input value={config.levelThresholds.join(',')} onChange={e => setConfig({ ...config, levelThresholds: e.target.value.split(',').map(Number) })}/></label></div>
      <p className="muted">{t('Message rules only score listed channels. First message, official discussion and chat never stack. Message Content Intent is required for automatic chat XP.')}</p>
      <div className="xp-rules">{config.rules.map((rule, index) => <details className="xp-rule" key={rule.event}><summary>{t(`xp.event.${rule.event}`)} <span className="badge">{rule.points} XP · {t(rule.enabled ? 'Enabled' : 'Disabled')}</span></summary>
        <label className="checkbox"><input type="checkbox" checked={rule.enabled} onChange={e => ruleChange(index, { enabled: e.target.checked })}/>{t('Enable this rule')}</label>
        <div className="form-grid"><label>{t('Rule label')}<input maxLength={80} value={rule.label} onChange={e => ruleChange(index, { label: e.target.value })}/></label><label>{t('XP per award')}<input type="number" min={1} max={10000} value={rule.points} onChange={e => ruleChange(index, { points: Number(e.target.value) })}/></label><label>{t('Daily XP cap (0 = none)')}<input type="number" min={0} max={100000} value={rule.dailyCap} onChange={e => ruleChange(index, { dailyCap: Number(e.target.value) })}/></label><label>{t('Cooldown (seconds)')}<input type="number" min={0} value={rule.cooldownSeconds} onChange={e => ruleChange(index, { cooldownSeconds: Number(e.target.value) })}/></label><label>{t('Eligible channel IDs (comma separated)')}<input disabled={!['first_message','chat','official_discussion'].includes(rule.event)} value={channels[rule.event] ?? ''} onChange={e => setChannels({ ...channels, [rule.event]: e.target.value })}/></label><label>{t('Starts at (UTC, optional)')}<input type="datetime-local" value={rule.startsAt?.slice(0, 16) ?? ''} onChange={e => ruleChange(index, { startsAt: e.target.value ? `${e.target.value}:00.000Z` : null })}/></label><label>{t('Ends at (UTC, optional)')}<input type="datetime-local" value={rule.endsAt?.slice(0, 16) ?? ''} onChange={e => ruleChange(index, { endsAt: e.target.value ? `${e.target.value}:00.000Z` : null })}/></label></div>
      <button disabled={busy} onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>{t('Remove rule')}</button></details>)}</div>
      <label>{t('Rule to add')}<select value={addEvent} onChange={e => setAddEvent(e.target.value)}>{xpEvents.map(value => <option key={value} value={value}>{t(`xp.event.${value}`)}</option>)}</select></label><button disabled={busy || config.rules.some(rule => rule.event === addEvent)} onClick={() => { const rule = structuredClone(xpDefaults.rules.find(rule => rule.event === addEvent)!); setConfig({ ...config, rules: [...config.rules, rule] }); setChannels({ ...channels, [rule.event]: '' }); }}>{t('Add rule')}</button>
      <label>{t('Reason for rule change')}<textarea minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label>
      <button className="primary" disabled={busy || reason.trim().length < 5} onClick={() => void run(async () => {
        await api('/xp/drafts', 'POST', { config: { ...config, rules: config.rules.map(rule => ({ ...rule, channels: (channels[rule.event] ?? '').split(',').map(v => v.trim()).filter(Boolean) })) }, reason });
        await load(); setNotice('XP draft saved. Review, approve and publish it below.');
      })}>{t('Save XP rules draft')}</button>
    </section>
    <section><h2>{t('XP rule history')}</h2>{overview.revisions.map(revision => <div className="revision" key={revision.id}><div><strong>v{revision.version}</strong> <span className="badge">{t(revision.status)}</span><p>{revision.reason}</p><small>{t('Author')}: {revision.authored_by} · {t('Approved by')}: {revision.approved_by ?? '—'}</small></div><div>
      <button disabled={busy} onClick={() => edit(revision.body)}>{t('Load into editor')}</button>
      {revision.status === 'DRAFT' && <button disabled={busy} onClick={() => void run(async () => { await api(`/xp/${revision.id}/approve`, 'POST', {}); await load(); setNotice('XP rules approved. Publication is still required.'); })}>{t('Approve XP rules')}</button>}
      {revision.status === 'APPROVED' && <button className="primary" disabled={busy} onClick={() => { if (window.confirm(t('Publish these XP rules? New events will use this version.'))) void run(async () => { await api(`/xp/${revision.id}/publish`, 'POST', { expectedVersion: overview.current.version, confirm: true }); await load(true); setNotice('XP rules published.'); }); }}>{t('Publish XP rules')}</button>}
      {revision.status === 'SUPERSEDED' && <button disabled={busy} onClick={() => void run(async () => { await api('/xp/drafts', 'POST', { config: revision.body, reason: `Restore rules v${revision.version} as a new draft` }); await load(); setNotice('XP draft saved. Review, approve and publish it below.'); })}>{t('Restore as draft')}</button>}
    </div></div>)}</section>
    <div className="two-col"><section><h2>{t('Manual XP adjustment')}</h2><p className="muted">{t('Corrections create signed ledger entries. A reason is required; balances cannot become negative.')}</p><form onSubmit={e => { e.preventDefault(); if (!window.confirm(t('Record this XP adjustment?'))) return; void run(async () => { await api('/xp/adjustments', 'POST', { userId: target, amount, reason: adjustReason, requestKey }); await load(); setRequestKey(crypto.randomUUID()); setAdjustReason(''); setNotice('XP adjustment recorded.'); }); }}><label>{t('Discord user ID')}<input required pattern="[0-9]{17,20}" value={target} onChange={e => setTarget(e.target.value)}/></label><label>{t('XP amount (negative to deduct)')}<input required type="number" min={-10000} max={10000} value={amount} onChange={e => setAmount(Number(e.target.value))}/></label><label>{t('Reason')}<textarea required minLength={5} maxLength={500} value={adjustReason} onChange={e => setAdjustReason(e.target.value)}/></label><button disabled={busy || !overview.current.body.enabled}>{t('Record adjustment')}</button></form></section>
    <section><h2>{t('Reviewed contribution')}</h2><p className="muted">{t('Use one stable source ID per reviewed issue, creation or event. Replaying it does not award twice.')}</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api('/xp/contributions', 'POST', { userId: target, event, source, reason: reviewReason }); if (!result.awarded) { setError(String(result.reason)); return; } await load(); setNotice('Contribution XP awarded.'); }); }}><label>{t('Discord user ID')}<input required pattern="[0-9]{17,20}" value={target} onChange={e => setTarget(e.target.value)}/></label><label>{t('Contribution type')}<select value={event} onChange={e => setEvent(e.target.value)}>{['creation','confirmed_issue','featured','event'].map(value => <option key={value} value={value}>{t(`xp.event.${value}`)}</option>)}</select></label><label>{t('Unique source ID')}<input required pattern="[a-zA-Z0-9:_-]{5,120}" value={source} onChange={e => setSource(e.target.value)}/></label><label>{t('Review reason')}<textarea required minLength={5} maxLength={500} value={reviewReason} onChange={e => setReviewReason(e.target.value)}/></label><button disabled={busy || !overview.current.body.enabled}>{t('Award reviewed contribution')}</button></form></section></div>
    <section><h2>{t('XP leaderboard')}</h2><label>{t('Period')}<select value={period} onChange={e => setPeriod(e.target.value as XpPeriod)}>{['weekly','monthly','all_time'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><button disabled={busy} onClick={() => void run(async () => { const result = await api<{ entries: Row[] }>(`/xp/leaderboard?period=${period}`); setBoard(result.entries); })}>{t('Load leaderboard')}</button>{board.map(row => <p key={String(row.user_id)}>#{String(row.rank)} · {String(row.user_id)} · {String(row.xp)} XP</p>)}</section>
    <section><h2>{t('XP ledger')}</h2><p className="muted">{t('Latest 100 entries. History commands show only the requesting member’s own entries.')}</p><div className="table-scroll"><table><thead><tr>{['Date','Member','XP','Source','Reason','Rule version','Operator'].map(value => <th key={value}>{t(value)}</th>)}</tr></thead><tbody>{overview.ledger.map(row => <tr key={String(row.id)}><td>{formatDate(locale, row.occurred_at)}</td><td>{String(row.user_id)}</td><td>{Number(row.amount) > 0 ? '+' : ''}{String(row.amount)}</td><td>{String(row.source_key)}</td><td>{String(row.reason)}</td><td>v{String(row.rule_version)}</td><td>{String(row.actor_id)}</td></tr>)}</tbody></table></div>{overview.ledger.length === 0 && <p>{t('No XP entries yet.')}</p>}</section>
    <section><h2>{t('Boost verification')}</h2><p className="muted">{t('Requires Server Members Intent and the worker. Historical Boosts are not automatically backfilled. Cancellation stops future awards; past XP remains.')}</p>{overview.boosts.map(row => <p key={String(row.user_id)}>{String(row.user_id)} · {t(row.active ? 'Active' : 'Inactive')} · {t('Next check')}: {formatDate(locale, row.next_check_at)}{row.last_error_code ? ` · ${String(row.last_error_code)}` : ''}</p>)}</section>
  </>;
}
