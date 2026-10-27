import { Person } from './People';
import { useEffect, useState } from 'react';
import { xpDefaults, xpEvents, type XpConfig, type XpRule, type XpPeriod } from '../../../packages/core/src/xp-config';
import { PointsDialog } from './PointsDialog';
import { PointsLedger, PointsMemberDialog, PointsPagination } from './PointsLedger';
import { translateError, formatDate, type Locale, type Values } from './i18n';

type Row = Record<string, unknown>;
type Revision = { id: string; version: number; status: string; body: XpConfig; reason: string; authored_by: string; approved_by: string | null; base_version: number | null; edit_version: number };
type Overview = { current: Revision; revisions: Revision[]; ledger: Row[]; boosts: Row[] };
type Api = <T = Row>(path: string, method?: string, input?: unknown) => Promise<T>;
export function PointsPanel({ api, active, refreshKey, locale, t }: { api: Api; active: boolean; refreshKey: number; locale: Locale; t: (key: string, values?: Values) => string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [config, setConfig] = useState<XpConfig | null>(null);
  const [excludedCategories, setExcludedCategories] = useState('');
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [sourceRevision, setSourceRevision] = useState<Revision | null>(null);
  const [baseline, setBaseline] = useState('');
  const [baseVersion, setBaseVersion] = useState(0);
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [history, setHistory] = useState<{ entries: Revision[]; page: number; pageSize: number; total: number } | null>(null);
  const [member, setMember] = useState<string | null>(null);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  async function loadHistory(page = 1) {
    setHistoryBusy(true);
    try { setHistory(await api(`/xp/revisions?page=${page}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setHistoryBusy(false); }
  }
  function edit(revision: Revision, publishedVersion = overview?.current.version ?? revision.version) {
    const value = revision.body;
    const pending = ['DRAFT', 'APPROVED'].includes(revision.status);
    const changeReason = pending ? revision.reason : '';
    setConfig(structuredClone(value));
    setSourceRevision(revision); setBaseVersion(pending ? revision.base_version ?? 0 : publishedVersion);
    setReason(changeReason); setBaseline(JSON.stringify({ config: value, reason: changeReason }));
    setExcludedCategories((value.excludedCategoryIds ?? []).join(', '));
    setChannels(Object.fromEntries(value.rules.map(rule => [rule.event, rule.channels.join(', ')])));
  }
  async function load(reset = false) {
    const result = await api<Overview>('/xp/config');
    setOverview(result); setLedgerRefresh(value => value + 1);
    if (reset || !config) edit(result.current, result.current.version);
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
  const editorValue = config ? { ...config, ...(config.excludedCategoryIds !== undefined ? { excludedCategoryIds: excludedCategories.split(',').map(v => v.trim()).filter(Boolean) } : {}), rules: config.rules.map(rule => ({ ...rule, channels: (channels[rule.event] ?? '').split(',').map(v => v.trim()).filter(Boolean) })) } : null;
  const dirty = JSON.stringify({ config: editorValue, reason }) !== baseline;
  const pending = !!sourceRevision && ['DRAFT', 'APPROVED'].includes(sourceRevision.status);
  const stale = pending && (baseVersion !== overview?.current.version || sourceRevision.version <= (overview?.current.version ?? 0));
  const latestSource = overview?.revisions.find(revision => revision.id === sourceRevision?.id);
  const conflict = pending && !!latestSource && (latestSource.edit_version !== sourceRevision?.edit_version || latestSource.status !== sourceRevision?.status);
  function mayReplace() { return !dirty || window.confirm(t('Discard unsaved XP edits?')); }
  if (!config || !overview) return <section><h2>{t('XP & Rewards')}</h2>{error ? <p role="alert">{translateError(locale, error)}</p> : <p>{t('Loading…')}</p>}</section>;
  return <>
    {error && <p className="error" role="alert">{translateError(locale, error)}</p>}
    {notice && <p className="notice" role="status">{t(notice)}</p>}
    <section className="points-overview"><div className="points-overview-header"><p>{t('Published XP rules v{version}', { version: overview.current.version })} · <strong>{t(overview.current.body.enabled ? 'Scoring enabled' : 'Scoring disabled')}</strong></p><button onClick={() => { setHistoryOpen(true); void loadHistory(); }}>{t('XP rule history')}</button></div><p className="muted">{t('Admins and moderators earn points. Only admins are excluded from leaderboards. Existing records are preserved.')}</p><details className="points-tools" open={rulesOpen} onToggle={event => setRulesOpen(event.currentTarget.open)}><summary>{t('Edit XP rules')}</summary><p className="muted">{t('Values below are proposals until reviewed and published. Changes apply to new events; previous awards stay in the ledger.')}</p>
      <p className="muted">{t('Create the agreed Evo Points proposal while keeping scoring paused. Existing published rules and past awards stay in place.')}</p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <p><strong>{t('Editing source v{version}', { version: sourceRevision?.version ?? overview.current.version })}</strong> · {t(sourceRevision?.status ?? 'PUBLISHED')} · {baseVersion > 0 ? t('Based on published v{version}', { version: baseVersion }) : t('Unknown base version (legacy draft)')}</p>
      <p role="note">{t(dirty ? 'Unsaved changes — save this draft before approving or publishing.' : pending ? 'Saved draft — approval and publication use this exact saved content.' : 'Editing published rules creates a new draft; live rules change only after publication.')}</p>
      {stale && <p className="error">{t('This draft is outdated. Copy it as a new draft based on the current published rules.')}</p>}
      {!pending && baseVersion !== overview.current.version && <p className="error">{t('Published rules changed. Load the current published version before creating a draft.')}</p>}
      {conflict && <p className="error">{t('This draft changed elsewhere. Load it again before continuing; your local edits are still here.')}</p>}
      <div className="xp-preset-action"><button type="button" disabled={busy} onClick={() => { if (!mayReplace()) return; void run(async () => {
        const revision = await api<Revision>('/xp/proposal', 'POST', {});
        edit(revision); await load();
        setNotice('Evo Points draft created. Review, approve and publish it below.');
      }); }}>{t('Create Evo Points draft')}</button></div>
      <div className="xp-scoring-toggle"><label className="checkbox" htmlFor="xp-scoring-enabled"><input id="xp-scoring-enabled" type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })}/>{t('Enable XP scoring')}</label><p className="muted">{t('Changing this switch only edits local values. It does not create or publish a draft; save explicitly when ready.')}</p></div>
      <div className="form-grid"><label>{t('XP timezone')}<input value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })}/></label>
      <label>{t('Minimum meaningful characters')}<input type="number" min={5} max={200} value={config.minimumCharacters} onChange={e => setConfig({ ...config, minimumCharacters: Number(e.target.value) })}/></label>
      <label>{t('Level thresholds (comma separated, starts at 0)')}<input value={config.levelThresholds.join(',')} onChange={e => setConfig({ ...config, levelThresholds: e.target.value.split(',').map(Number) })}/></label></div>
      <p className="muted">{t('Chat scores across the server except excluded categories and announcement channels. Threads inherit their parent category. Message Content Intent is required. Official discussion bonuses are unused in category mode.')}</p>
      {config.excludedCategoryIds === undefined && <p>{t('Published legacy rules still use channel lists until a category exclusion draft is published.')}</p>}
      <button onClick={() => { setConfig({ ...config, excludedCategoryIds: ['1560526464481501345', '1560526751317106819', '1560526680613716068'] }); setExcludedCategories('1560526464481501345, 1560526751317106819, 1560526680613716068'); }}>{t('Use EvoMeme exclusions: OFFICIAL, EVENTS, STAFF ONLY')}</button>
      <label>{t('Excluded category IDs (comma separated)')}<input value={excludedCategories} onChange={e => { setExcludedCategories(e.target.value); setConfig({ ...config, excludedCategoryIds: [] }); }}/></label>
      <div className="xp-rules">{config.rules.map((rule, index) => <details className="xp-rule" key={rule.event}><summary>{t(`xp.event.${rule.event}`)} <span className="badge">{rule.points} XP · {t(rule.enabled ? 'Enabled' : 'Disabled')}</span></summary>
        <label className="checkbox"><input type="checkbox" checked={rule.enabled} onChange={e => ruleChange(index, { enabled: e.target.checked })}/>{t('Enable this rule')}</label>
        <div className="form-grid"><label>{t('Rule label')}<input maxLength={80} value={rule.label} onChange={e => ruleChange(index, { label: e.target.value })}/></label><label>{t('XP per award')}<input type="number" min={1} max={10000} value={rule.points} onChange={e => ruleChange(index, { points: Number(e.target.value) })}/></label><label>{t('Daily XP cap (0 = none)')}<input type="number" min={0} max={100000} value={rule.dailyCap} onChange={e => ruleChange(index, { dailyCap: Number(e.target.value) })}/></label><label>{t('Cooldown (seconds)')}<input type="number" min={0} value={rule.cooldownSeconds} onChange={e => ruleChange(index, { cooldownSeconds: Number(e.target.value) })}/></label>{config.excludedCategoryIds === undefined && <label>{t('Eligible channel IDs (comma separated)')}<input disabled={!['first_message','chat','official_discussion'].includes(rule.event)} value={channels[rule.event] ?? ''} onChange={e => setChannels({ ...channels, [rule.event]: e.target.value })}/></label>}<label>{t('Starts at (UTC, optional)')}<input type="datetime-local" value={rule.startsAt?.slice(0, 16) ?? ''} onChange={e => ruleChange(index, { startsAt: e.target.value ? `${e.target.value}:00.000Z` : null })}/></label><label>{t('Ends at (UTC, optional)')}<input type="datetime-local" value={rule.endsAt?.slice(0, 16) ?? ''} onChange={e => ruleChange(index, { endsAt: e.target.value ? `${e.target.value}:00.000Z` : null })}/></label></div>
      <button disabled={busy} onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>{t('Remove rule')}</button></details>)}</div>
      <label>{t('Rule to add')}<select value={addEvent} onChange={e => setAddEvent(e.target.value)}>{xpEvents.map(value => <option key={value} value={value}>{t(`xp.event.${value}`)}</option>)}</select></label><button disabled={busy || config.rules.some(rule => rule.event === addEvent)} onClick={() => { const rule = structuredClone(xpDefaults.rules.find(rule => rule.event === addEvent)!); setConfig({ ...config, rules: [...config.rules, rule] }); setChannels({ ...channels, [rule.event]: '' }); }}>{t('Add rule')}</button>
      <label>{t('Reason for rule change')}<textarea minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label>
      <p className="muted">{t('A change reason of at least 5 characters is required. Saving an approved draft removes its approval.')}</p>
      <button className="primary" disabled={busy || !dirty || stale || conflict || baseVersion !== overview.current.version || reason.trim().length < 5} onClick={() => void run(async () => {
        const revision = pending && sourceRevision
          ? await api<Revision>(`/xp/${sourceRevision.id}/draft`, 'PUT', { config: editorValue, reason, expectedVersion: baseVersion, expectedEditVersion: sourceRevision.edit_version })
          : await api<Revision>('/xp/drafts', 'POST', { config: editorValue, reason, expectedVersion: baseVersion });
        edit(revision); await load(); setNotice('XP draft saved. Review, approve and publish it below.');
      })}>{t('Save XP rules draft')}</button>
      {pending && sourceRevision && !stale && <>
        {sourceRevision.status === 'DRAFT' && <button disabled={busy || dirty || conflict} onClick={() => void run(async () => {
          const revision = await api<Revision>(`/xp/${sourceRevision.id}/approve`, 'POST', { expectedEditVersion: sourceRevision.edit_version });
          edit(revision); await load(); setNotice('XP rules approved. Publication is still required.');
        })}>{t('Approve XP rules')}</button>}
        {sourceRevision.status === 'APPROVED' && <button className="primary" disabled={busy || dirty || conflict} onClick={() => {
          if (window.confirm(t('Publish saved XP rules v{version}? Only the saved draft will go live.', { version: sourceRevision.version }))) void run(async () => {
            await api(`/xp/${sourceRevision.id}/publish`, 'POST', { expectedVersion: baseVersion, expectedEditVersion: sourceRevision.edit_version, confirm: true });
            await load(true); setNotice('XP rules published.');
          });
        }}>{t('Publish XP rules')}</button>}
      </>}
      </fieldset>
      </details>
    </section>
    <PointsLedger api={api} refreshKey={ledgerRefresh} locale={locale} t={t} onMember={setMember}/>
    {historyOpen && <PointsDialog title={t('XP rule history')} closeLabel={t('Close')} onClose={() => setHistoryOpen(false)}>
      {error && <p className="error" role="alert">{translateError(locale, error)}</p>}
      {history ? <>{history.entries.map(revision => {
      const outdated = ['DRAFT','APPROVED'].includes(revision.status) && (revision.base_version !== overview.current.version || revision.version <= overview.current.version);
      return <div className="revision" key={revision.id}><div><strong>v{revision.version}</strong> <span className="badge">{t(outdated ? 'Outdated draft' : revision.status)}</span>{sourceRevision?.id === revision.id && <span className="badge">{t('In editor')}</span>}<p>{revision.reason}</p><small>{t('Author')}: <Person id={revision.authored_by}/> · {t('Approved by')}: <Person id={revision.approved_by}/></small></div><div>
        <button disabled={busy} onClick={() => { if (mayReplace()) { edit(revision); setHistoryOpen(false); setRulesOpen(true); } }}>{t('Load into editor')}</button>
        {(outdated || revision.status === 'SUPERSEDED') && <button disabled={busy} onClick={() => { if (!mayReplace()) return; void run(async () => {
          const copy = await api<Revision>('/xp/drafts', 'POST', { config: revision.body, reason: `Restore rules v${revision.version} as a new draft`, expectedVersion: overview.current.version });
          edit(copy); setHistoryOpen(false); setRulesOpen(true); await load(); setNotice('XP draft saved. Review, approve and publish it below.');
        }); }}>{t('Restore as draft')}</button>}
      </div></div>;
    })}<PointsPagination data={history} busy={historyBusy || busy} load={page => { void loadHistory(page); }} t={t}/></> : <p>{t('Loading…')}</p>}
    </PointsDialog>}
    {member && <PointsMemberDialog key={member} userId={member} api={api} locale={locale} t={t} onClose={() => setMember(null)}/>}
    <details className="points-tools"><summary>{t('Adjustments and contributions')}</summary><div className="two-col"><section><h2>{t('Manual XP adjustment')}</h2><p className="muted">{t('Corrections create signed ledger entries. A reason is required; balances cannot become negative.')}</p><form onSubmit={e => { e.preventDefault(); if (!window.confirm(t('Record this XP adjustment?'))) return; void run(async () => { await api('/xp/adjustments', 'POST', { userId: target, amount, reason: adjustReason, requestKey }); await load(); setRequestKey(crypto.randomUUID()); setAdjustReason(''); setNotice('XP adjustment recorded.'); }); }}><label>{t('Discord user ID')}<input required pattern="[0-9]{17,20}" value={target} onChange={e => setTarget(e.target.value)}/></label><label>{t('XP amount (negative to deduct)')}<input required type="number" min={-10000} max={10000} value={amount} onChange={e => setAmount(Number(e.target.value))}/></label><label>{t('Reason')}<textarea required minLength={5} maxLength={500} value={adjustReason} onChange={e => setAdjustReason(e.target.value)}/></label><button disabled={busy || !overview.current.body.enabled}>{t('Record adjustment')}</button></form></section>
    <section><h2>{t('Reviewed contribution')}</h2><p className="muted">{t('Use one stable source ID per reviewed issue, creation or event. Replaying it does not award twice.')}</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api('/xp/contributions', 'POST', { userId: target, event, source, reason: reviewReason }); if (!result.awarded) { setError(String(result.reason)); return; } await load(); setNotice('Contribution XP awarded.'); }); }}><label>{t('Discord user ID')}<input required pattern="[0-9]{17,20}" value={target} onChange={e => setTarget(e.target.value)}/></label><label>{t('Contribution type')}<select value={event} onChange={e => setEvent(e.target.value)}>{['creation','confirmed_issue','featured','event'].map(value => <option key={value} value={value}>{t(`xp.event.${value}`)}</option>)}</select></label><label>{t('Unique source ID')}<input required pattern="[a-zA-Z0-9:_-]{5,120}" value={source} onChange={e => setSource(e.target.value)}/></label><label>{t('Review reason')}<textarea required minLength={5} maxLength={500} value={reviewReason} onChange={e => setReviewReason(e.target.value)}/></label><button disabled={busy || !overview.current.body.enabled}>{t('Award reviewed contribution')}</button></form></section></div></details>
    <details className="points-tools"><summary>{t('XP leaderboard')}</summary><label>{t('Period')}<select value={period} onChange={e => setPeriod(e.target.value as XpPeriod)}>{['weekly','monthly','all_time'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><button disabled={busy} onClick={() => void run(async () => { const result = await api<{ entries: Row[] }>(`/xp/leaderboard?period=${period}`); setBoard(result.entries); })}>{t('Load leaderboard')}</button>{board.map(row => <p key={String(row.user_id)}>#{String(row.rank)} · <button className="link-button" onClick={() => setMember(String(row.user_id))}><Person id={row.user_id}/></button> · {String(row.xp)} XP</p>)}</details>
    <details className="points-tools"><summary>{t('Boost verification')}</summary><p className="muted">{t('Requires Server Members Intent and the worker. Historical Boosts are not automatically backfilled. Cancellation stops future awards; past XP remains.')}</p>{overview.boosts.map(row => <p key={String(row.user_id)}><Person id={row.user_id}/> · {t(row.active ? 'Active' : 'Inactive')} · {t('Next check')}: {formatDate(locale, row.next_check_at)}{row.last_error_code ? ` · ${String(row.last_error_code)}` : ''}</p>)}</details>
  </>;
}
