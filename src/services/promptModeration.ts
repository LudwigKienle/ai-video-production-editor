/**
 * Midjourney has no API and moderates prompts in the web UI. When Jeff reports a
 * blocked prompt, the caller softens the prompt here (no network) and retries;
 * the second retry may also ask Gemini for a rewrite. Parameters (everything from
 * the first " --" on) are preserved, only the description changes.
 */

export const MODERATION_ERROR_PREFIX = '[moderated]';

const MODERATION_MESSAGE_RX = /\[moderated\]|banned prompt|blocked by|blocked|moderat|flagged|community guidelines|not allowed|violat|inappropriate/i;

export const isModerationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return MODERATION_MESSAGE_RX.test(message);
};

/** Split "description --ar 16:9 --v 8.2" into its two halves. */
export const splitPromptParams = (prompt: string): { body: string; params: string } => {
  const match = prompt.match(/\s--[a-z]/i);
  if (!match || match.index === undefined) return { body: prompt.trim(), params: '' };
  return { body: prompt.slice(0, match.index).trim(), params: prompt.slice(match.index).trim() };
};

const CHILD_HINT_RX = /\b(child|children|kid|kids|minor|teen|teenager|toddler|preteen|boy|girl|schoolgirl|schoolboy|infant|baby|young)\b/i;

/** Level 1: targeted swaps that keep the shot's intent. */
const SWAPS_LEVEL_1: Array<[RegExp, string]> = [
  [/\b(nude|naked|nudity|undressed|unclothed|topless|bare-?chested)\b/gi, 'in plain neutral base-layer clothing'],
  [/\b(lingerie|underwear|panties|bra|bikini|swimsuit)\b/gi, 'simple fitted base-layer clothing'],
  [/\b(sexy|seductive|erotic|sensual|sultry|provocative)\b/gi, 'elegant'],
  [/\b(breasts?|cleavage|nipples?|buttocks|genitals?)\b/gi, 'torso'],
  [/\b(bloody|blood-?soaked|blood-?stained|bloodied)\b/gi, 'grimy'],
  [/\b(blood|gore|gory|guts|entrails|viscera|intestines)\b/gi, 'dark stains'],
  [/\b(corpses?|dead bod(?:y|ies)|cadavers?|carcass(?:es)?)\b/gi, 'motionless figure'],
  [/\b(decapitat\w*|dismember\w*|severed|mutilat\w*|disembowel\w*)\b/gi, 'broken'],
  [/\b(torture[sd]?|torturing)\b/gi, 'interrogation'],
  [/\b(kill(?:s|ed|ing)?|murder(?:s|ed|ing)?|slaughter(?:s|ed|ing)?|massacre[sd]?|execut(?:e|es|ed|ion))\b/gi, 'confront'],
  [/\b(suicide|self-?harm|hang(?:s|ed|ing) (?:him|her|them)self)\b/gi, 'despair'],
  [/\b(wounded|wounds?|injur(?:y|ies|ed)|bleeding)\b/gi, 'bruised'],
  [/\b(cocaine|heroin|meth(?:amphetamine)?|crack pipe|syringe of drugs|drugs?)\b/gi, 'pills'],
  [/\b(nazi|hitler|swastika|third reich|ss officer)\b/gi, '1940s uniformed officer'],
  [/\b(terrorists?|jihad\w*|isis)\b/gi, 'militant'],
  [/\b(rape[sd]?|raping|molest\w*|sexual assault)\b/gi, 'threatened'],
];

/** Level 2: drop whole sentences that still carry risky words and add a --no list. */
const RISKY_RX = /\b(blood|gore|gory|corpse|dead|death|kill|murder|nude|naked|sex|sexual|erotic|torture|wound|drug|weapon|gun|knife|violence|violent|brutal|horror|terror|abuse|hostage|bomb|explosion|suicide|hell|demon|satanic|nazi)\w*\b/i;

const NEGATIVE_TERMS = ['blood', 'gore', 'nudity', 'text', 'watermark'];

const mergeNegatives = (params: string): string => {
  const existing = params.match(/--no\s+([^-][^\n]*?)(?=\s--|$)/i);
  const current = existing ? existing[1].split(',').map((term) => term.trim()).filter(Boolean) : [];
  const merged = Array.from(new Set([...current, ...NEGATIVE_TERMS]));
  if (existing) return params.replace(existing[0], `--no ${merged.join(', ')}`);
  return `${params} --no ${merged.join(', ')}`.trim();
};

const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',').replace(/\(\s*\)/g, '').trim();

export const softenPromptForModeration = (prompt: string, level: 1 | 2): string => {
  const { body, params } = splitPromptParams(prompt);
  let next = body;
  const childContext = CHILD_HINT_RX.test(body);
  if (childContext) {
    // A base sheet of a young character must never read as undressed.
    next = next.replace(/\b(underwear|lingerie|swimsuit|bikini|nude|naked|topless|shirtless|t-?pose in (?:plain )?underwear)\b/gi, 'plain t-shirt and shorts');
  }
  for (const [pattern, replacement] of SWAPS_LEVEL_1) next = next.replace(pattern, replacement);
  next = tidy(next);
  if (level === 1) return tidy(`${next} ${params}`);

  const sentences = next.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter((sentence) => !RISKY_RX.test(sentence));
  const base = kept.length > 0 ? kept.join(' ') : next.replace(RISKY_RX, '').replace(/\s{2,}/g, ' ');
  const softened = tidy(`${base} Cinematic, tasteful, no graphic detail.`);
  return tidy(`${softened} ${mergeNegatives(params)}`);
};
