/**
 * Tool / node search used by the Fusion "Select Tool" popup (Shift+Space) and
 * the Nuke Tab menu. Ranking: exact name, name prefix, word prefix, initials
 * (e.g. "cc" → Color Corrector), short code, keyword prefix, substring, then a
 * loose subsequence match.
 */
export type SearchableTool = { id: string; label: string; short?: string; keywords?: string[] };

const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .trim();

const words = (value: string) => norm(value).split(/\s+|(?=[A-Z])/).filter(Boolean);

const initials = (label: string) =>
  label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s+_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toLowerCase())
    .join('');

const isSubsequence = (needle: string, hay: string) => {
  let index = 0;
  for (const char of hay) if (char === needle[index]) index += 1;
  return index === needle.length;
};

export function scoreTool(tool: SearchableTool, query: string): number {
  const q = norm(query).replace(/\s+/g, ' ');
  if (!q) return 1;
  const label = norm(tool.label);
  const compactLabel = label.replace(/\s+/g, '');
  const compactQ = q.replace(/\s+/g, '');
  if (label === q || compactLabel === compactQ) return 100;
  if (tool.short && norm(tool.short) === compactQ) return 90;
  if (label.startsWith(q) || compactLabel.startsWith(compactQ)) return 80;
  if (words(tool.label).some((word) => word.startsWith(q))) return 70;
  if (initials(tool.label) === compactQ) return 65;
  if (initials(tool.label).startsWith(compactQ) && compactQ.length > 1) return 60;
  const keywords = (tool.keywords ?? []).map(norm);
  if (keywords.some((keyword) => keyword === q)) return 58;
  if (keywords.some((keyword) => keyword.startsWith(q))) return 55;
  if (label.includes(q)) return 45;
  if (keywords.some((keyword) => keyword.includes(q))) return 35;
  if (compactQ.length > 1 && isSubsequence(compactQ, compactLabel)) return 20;
  return 0;
}

/** Matching tools, best first (stable for equal scores). Empty query returns all. */
export function searchTools<T extends SearchableTool>(tools: T[], query: string, limit = 50): T[] {
  return tools
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.tool);
}
