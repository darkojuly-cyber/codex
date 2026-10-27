export const riskPresets = ['scam_links', 'mass_mentions'] as const;
export function riskMatches(content: string, keywords: string[], presets: readonly string[], mentionCount = 0, mentionEveryone = false) {
  const text = content.normalize('NFKC').toLocaleLowerCase();
  const matches = keywords.filter(word => text.includes(word.normalize('NFKC').toLocaleLowerCase()));
  const hasLink = /(?:https?:\/\/|www\.|discord\.gg\/)/i.test(text);
  // Combined cues are review hints. These rules never delete, time out or ban.
  const inducement = /claim\s+(?:your\s+)?free\s+nitro|free\s+nitro\s+(?:here|claim)|connect\s+your\s+wallet|verify\s+your\s+wallet|guaranteed\s+(?:profit|returns)|(?:稳赚|保证收益|保本高收益)|(?:领取|免费领).{0,12}(?:nitro|空投)|(?:私信|私聊).{0,12}(?:投资|收益|赚钱)/i.test(text);
  if (presets.includes('scam_links') && hasLink && inducement) matches.push('preset:scam_links');
  if (presets.includes('mass_mentions') && (mentionEveryone || mentionCount >= 5)) matches.push('preset:mass_mentions');
  return [...new Set(matches)];
}
