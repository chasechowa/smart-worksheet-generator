/**
 * Worksheet title resolution.
 *
 * Most copied articles start with their own headline ("The Rise of Usership").
 * Use that when it looks like a title; otherwise ask the model for one. The
 * summary section can also supply a title, which wins when present.
 */
export function deriveArticleTitle(article: string): string | null {
  const lines = String(article ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let first = lines[0];
  const heading = /^#{1,6}\s+(.*)$/.exec(first);
  if (heading) first = heading[1].trim();

  first = first.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!first) return null;
  if (first.length > 90) return null;
  if (/\bhttps?:\/\//i.test(first)) return null;

  const words = first.split(/\s+/).filter(Boolean);
  if (words.length > 12) return null;
  if (/[?!]$/.test(first)) return null;
  if (/[.]$/.test(first) && words.length > 8) return null;

  return first.replace(/\s+/g, ' ');
}

export function resolveWorksheetTitle(
  summaryTitle: string | undefined,
  generatedTitle: string | undefined,
  article: string,
): string {
  const clean = (value: unknown) => {
    const text = String(value ?? '').trim();
    return /^untitled worksheet$/i.test(text) ? '' : text;
  };

  return clean(summaryTitle) || clean(generatedTitle) || deriveArticleTitle(article) || 'Untitled Worksheet';
}

export function buildTitlePrompt(article: string): string {
  return `
Create a short worksheet title for this ESL reading article.

Return ONLY valid JSON:
{"title": "..."}

Rules:
- 3-8 words, Title Case, no surrounding quotes.
- Capture the article's central topic or argument.
- If the article's first line is already a title, reuse or lightly adapt it.
- Do not use the words "Worksheet", "Reading", or "Article" in the title.

Article (first 4000 characters):
${String(article ?? '').slice(0, 4000)}
`;
}
