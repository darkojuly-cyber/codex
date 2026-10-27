import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { formatDate, resolveLocale, roleName, translate, translateError, translateNotice } from '../apps/admin-console/src/i18n/index.js';
import { zhCN } from '../apps/admin-console/src/i18n/zh-CN.js';

describe('Console localization', () => {
  it('honors explicit preference before the browser language and falls back safely', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
    expect(resolveLocale(null, ['zh-TW', 'en'])).toBe('zh-CN');
    expect(resolveLocale('invalid', ['fr-FR', 'zh-CN'])).toBe('zh-CN');
    expect(resolveLocale(null, ['en-GB', 'zh-CN'])).toBe('en');
    expect(resolveLocale(null, ['de-DE'])).toBe('en');
    expect(resolveLocale(null, [])).toBe('en');
  });
  it('interpolates complete messages without reinterpreting user-authored content', () => {
    const body = '<img src=x> {channel} 你好';
    expect(translate('zh-CN', 'Queue this message to channel {channel}?\n\n{body}', { channel: '123', body }))
      .toBe(`确认将此消息加入频道 123 的投递队列？\n\n${body}`);
    expect(translate('en', 'Queue this message to channel {channel}?\n\n{body}', { channel: '123', body }))
      .toBe(`Queue this message to channel 123?\n\n${body}`);
    expect(translate('zh-CN', 'Unknown technical value')).toBe('Unknown technical value');
  });
  it('localizes stored success messages and errors while retaining diagnostic codes', () => {
    expect(translateNotice('zh-CN', 'Created private mock ticket #123. Open Tickets to review.')).toBe('已创建私密模拟工单 #123，请在“工单”页查看。');
    expect(translateNotice('en', 'Configuration published.')).toBe('Configuration published.');
    expect(translateError('zh-CN', 'ORIGIN_REJECTED')).toContain('请求来源未获允许');
    expect(translateError('zh-CN', 'VALIDATION_ERROR: channels.publish: invalid ID')).toContain('channels.publish: invalid ID');
    expect(translateError('en', 'ORIGIN_REJECTED')).toBe('ORIGIN_REJECTED');
    expect(roleName('en', 'COMMUNITY_MANAGER')).toBe('COMMUNITY MANAGER');
    expect(roleName('zh-CN', 'COMMUNITY_MANAGER')).toBe('社区运营管理员');
  });
  it('formats dates using the selected language without changing the stored timestamp', () => {
    const timestamp = '2026-10-23T12:00:00.000Z';
    expect(formatDate('zh-CN', timestamp)).toBe(new Date(timestamp).toLocaleString('zh-CN'));
    expect(formatDate('en', timestamp)).toBe(new Date(timestamp).toLocaleString('en-US'));
    expect(formatDate('zh-CN', null)).toBe('—');
    expect(formatDate('en', 'not a timestamp')).toBe('—');
  });
  it('has Chinese copy for every statically translated label and all feature switches', async () => {
    const keys = new Set<string>();
    for (const filename of ['main.tsx', 'PointsPanel.tsx', 'PointsLedger.tsx', 'PointsDialog.tsx', 'TicketsPanel.tsx', 'StaffPanel.tsx', 'OperationsDashboard.tsx', 'ActivityCharts.tsx']) {
      const source = await readFile(new URL(`../apps/admin-console/src/${filename}`, import.meta.url), 'utf8');
      const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    for (const key of keys) expect(zhCN[key], `Missing Chinese copy: ${key}`).toBeTruthy();
    for (const key of ['welcome', 'tickets', 'messaging', 'web', 'ios', 'android']) expect(zhCN[`feature.${key}`]).toBeTruthy();
  });
});
