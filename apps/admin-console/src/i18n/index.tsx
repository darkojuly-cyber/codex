import { useEffect, useState } from 'react';
import { zhCN } from './zh-CN';

export type Locale = 'en' | 'zh-CN';
export type Values = Record<string, string | number>;
export const languageStorageKey = 'evomeme.console.language';
const english: Record<string, string> = {
  'xp.event.manual': 'Manual adjustment',
  'Console title': 'EvoMeme Community Console',
  "xp.event.first_message": "First Message",
  "xp.event.chat": "Chat",
  "xp.event.official_discussion": "Official Discussion",
  "xp.event.creation": "Creation",
  "xp.event.confirmed_issue": "Confirmed Issue",
  "xp.event.featured": "Featured",
  "xp.event.event": "Event",
  "xp.event.boost_first": "Boost First",
  "xp.event.boost_30d": "Boost 30D",

  'feature.welcome': 'welcome', 'feature.tickets': 'tickets', 'feature.messaging': 'messaging',
  'feature.web': 'web', 'feature.ios': 'ios', 'feature.android': 'android',
  'link.intro': 'INTRO', 'link.web': 'WEB', 'link.ios': 'IOS', 'link.android': 'ANDROID',
};

export function resolveLocale(saved: unknown, languages: readonly string[]): Locale {
  if (saved === 'en' || saved === 'zh-CN') return saved;
  // Respect the browser's primary supported language, then English as fallback.
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}
export function translate(locale: Locale, key: string, values: Values = {}) {
  const message = (locale === 'zh-CN' ? zhCN[key] : english[key]) ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

const errorCopy: Record<string, string> = {
  GUILD_MEMBER_NOT_FOUND: '找不到该服务器成员，请核对用户 ID；目标必须仍在服务器中。',
  MEMBER_LOOKUP_UNAVAILABLE: '暂时无法核实目标成员，请稍后重试；现有授权未更改。',
  STAFF_HUMAN_REQUIRED: '工作人员授权仅支持真实用户账号，不能授权机器人。',
  RISK_SCOPE_REQUIRED: '启用前请填写公开频道 ID 和关键词。',
  ROOT_ACCESS_PROTECTED: '不能在后台修改受保护的超级管理员授权。',
  STAFF_ACCESS_REVOKED: '该账号的后台访问权限已被撤销。',
  RISK_ALREADY_REVIEWED: '该线索已被审核，请刷新查看。',

  'TICKET_REPLY_CLOSED': '该工单不接受新回复，请先在允许时间内重新打开。',
  'TICKET_REPLY_KEY_CONFLICT': '该回复请求已经使用过。请刷新核对已有回复，再发送其他内容。',
  'TICKET_REPLY_UNKNOWN': '无法确认 Discord 是否已接收，请先到频道核查，不要直接重复发送。',
  'TICKET_REPLY_NO_LONGER_AUTHORIZED': '工单状态或分配已变化，该回复已取消发送。',
  'TICKET_CHANNEL_MISSING': '此旧工单没有有效私密频道，请提交新工单。',

  'TICKET_CHANGED': '工单已被其他工作人员修改，请载入最新版本后重试。',
  'TICKET_HOURLY_LIMIT': '该成员最近提交的工单过多，请稍后再试。',
  'TICKET_SYNC_FAILED': 'Discord 同步失败；数据库记录已保留，请检查频道权限并重试同步。',
  'TICKET_PANEL_UNKNOWN': '无法确认入口面板的上次发布结果，请先检查频道，再决定是否替换。',
  'TICKET_NOT_ISSUE': '只有问题报告或功能建议可通过此入口发放确认问题积分。',

  'XP_MEMBER_NOT_ELIGIBLE': '该账号无法参与积分（例如机器人或已离开服务器的成员）。',
  'XP_ELIGIBILITY_UNAVAILABLE': '暂时无法核实成员资格，本次不会发分，请稍后重试。',
  'XP_DATE_RANGE': '开始日期不能晚于结束日期。',

  "XP_DRAFT_STALE": "此积分草稿已过期，不能直接发布。请复制为基于当前版本的新草稿后重新审核。",
  "XP_DRAFT_CHANGED": "此积分草稿已被修改，请载入最新草稿后重新审核。你的本地编辑不会自动覆盖它。",

  "XP_DISABLED": "积分计分已关闭，请先审核并发布启用规则。",
  "XP_NOT_INITIALIZED": "积分配置尚未初始化。",
  "XP_DRAFT_NOT_FOUND": "该积分草稿不存在或已审核。",
  "XP_CONFIG_CHANGED": "已发布的积分规则发生变化，请刷新后重试。",
  "XP_APPROVAL_REQUIRED": "请先审核通过该积分规则。",
  "XP_INSUFFICIENT_BALANCE": "扣分不能超过当前积分余额。",
  "XP_IDEMPOTENCY_CONFLICT": "这个请求标识已用于其他调整，请核查之前的流水。",
  "XP_MEMBER_UNAVAILABLE": "无法验证目标成员是否属于当前服务器。",
  "XP_BOT_NOT_ELIGIBLE": "机器人账号不参与积分奖励。",
  "DUPLICATE_EVENT": "该来源已发过积分，不会重复发放。",
  "DAILY_CAP": "该成员已达到此规则的每日奖励上限。",
  "COOLDOWN": "当前规则仍在冷却期。",
  "ALREADY_REWARDED": "该成员已领取过这项一次性奖励。",
  "EVENT_OUTSIDE_RULE_VERSION": "事件发生在当前规则生效前，不会追溯发放。",
  "RULE_OUTSIDE_WINDOW": "当前事件不在规则有效期内。",
  "CHANNEL_NOT_ELIGIBLE": "该频道不属于当前规则的计分范围。",

  ORIGIN_REJECTED: '请求来源未获允许，请检查浏览器地址与后台 PUBLIC_ORIGIN 配置。',
  CSRF_REJECTED: '安全校验失败，请刷新页面后重试。',
  FORBIDDEN: '当前角色没有此操作权限。',
  LOGIN_REQUIRED: '请先登录。', SESSION_EXPIRED: '登录已过期，请重新登录。',
  CONFIG_CHANGED_RELOAD: '配置已被其他操作更新，请刷新后重试。',
  VALIDATION_ERROR: '输入校验失败，请检查以下字段。',
  CHANNEL_NOT_APPROVED: '该频道尚未获准发布，请先绑定并发布配置。',
  CHANNEL_OUTSIDE_GUILD: '频道不属于当前绑定的公会。',
  DISCORD_WRITES_DISABLED: '真实 Discord 写入尚未启用。',
  TICKET_BINDINGS_REQUIRED: '请先配置已批准的工单分类及员工角色。',
  INVALID_TICKET_CATEGORY: '工单分类无效，请核对公会与分类 ID。',
  CONFIG_NOT_INITIALIZED: '配置尚未初始化。', DRAFT_NOT_FOUND: '未找到该草稿。',
  REVISION_NOT_FOUND: '未找到该配置版本。', NO_APPROVED_SEEDS: '暂无已审核并启用的灵感种子。',
  IDEA_HOURLY_LIMIT: '已达到每小时灵感抽取上限。', PROMPT_DAILY_LIMIT: '已达到今日提示词生成上限。',
  SEED_NOT_AVAILABLE: '该灵感种子当前不可用。', TICKET_NOT_FOUND: '工单不存在或你没有访问权限。',
  TICKETS_PENDING_APPROVAL: '工单功能尚待批准或未配置分类。', ACTIVE_TICKET_LIMIT: '已达到活跃工单上限。',
  TICKET_NOT_ACTIVE: '当前工单状态不允许此操作。', CANNOT_REASSIGN: '你没有重新分配该工单的权限。',
  REOPEN_WINDOW_EXPIRED: '工单已超出允许重新打开的时限。', SCHEDULE_IN_PAST: '排期时间不能早于当前时间。',
  JOB_NOT_DRAFT: '该消息已不处于草稿状态，请刷新。', JOB_CANNOT_CANCEL: '当前任务状态无法取消。',
  GUILD_MEMBERSHIP_UNAVAILABLE: '暂时无法验证公会成员身份，请稍后重试。', STAFF_ROLE_REQUIRED: '需要已授权的员工角色。',
  MOCK_LOCALHOST_ONLY: '模拟模式仅允许本机访问。', NOT_FOUND: '未找到请求的内容。',
  OAUTH_NOT_CONFIGURED: '尚未配置 Discord 员工登录。', OAUTH_STATE_REJECTED: '登录安全状态不匹配，请重新发起登录。',
  OAUTH_STATE_EXPIRED: '登录授权已过期，请重新登录。', OAUTH_EXCHANGE_FAILED: 'Discord 授权交换失败，请重新登录。',
  OAUTH_IDENTITY_FAILED: '无法获取 Discord 身份，请重新登录。', RATE_LIMITED: '操作过于频繁，请稍后重试。',
  INTERNAL_ERROR: '后台处理失败，请稍后重试或联系管理员。', BAD_REQUEST: '请求格式不正确。',
  PRIVATE_CHANNEL_PROVISION_FAILED: '私密频道创建失败，请联系管理员。',
  PRIVATE_CHANNEL_CLEANUP_REQUIRED: '私密频道创建异常，需要管理员核查并清理。',
};
export function translateError(locale: Locale, message: string) {
  if (locale === 'en') return message;
  const code = message.split(':', 1)[0];
  return errorCopy[code] ? `${errorCopy[code]} (${code})${message.slice(code.length)}` : translate(locale, message);
}
export function translateNotice(locale: Locale, message: string) {
  const ticket = /^Created private mock ticket #(\d+)\. Open Tickets to review\.$/.exec(message);
  return ticket ? translate(locale, 'Created private mock ticket #{number}. Open Tickets to review.', { number: ticket[1] }) : translate(locale, message);
}
export function roleName(locale: Locale, role: string) {
  return locale === 'en' ? role.replaceAll('_', ' ') : translate(locale, role);
}
export function formatDate(locale: Locale, value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
}
function browserLocale() {
  let saved: unknown;
  try { saved = window.localStorage.getItem(languageStorageKey); } catch { /* Storage can be unavailable in private browsing. */ }
  return resolveLocale(saved, window.navigator.languages ?? [window.navigator.language]);
}
export function useConsoleLanguage() {
  const [locale, setLocale] = useState<Locale>(browserLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'Console title');
    try { window.localStorage.setItem(languageStorageKey, locale); } catch { /* Keep switching usable without persistence. */ }
  }, [locale]);
  return { locale, setLocale, t: (key: string, values?: Values) => translate(locale, key, values) };
}
export function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (value: Locale) => void }) {
  return <label className="language-switch"><span>语言 / Language</span><select aria-label="语言 / Language" value={locale} onChange={event => { if (event.target.value === 'en' || event.target.value === 'zh-CN') onChange(event.target.value); }}>
    <option value="zh-CN">简体中文</option><option value="en">English</option>
  </select></label>;
}
