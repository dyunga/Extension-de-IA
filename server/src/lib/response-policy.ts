const QUESTIONNAIRE_PATTERN = /^(?:\d+\s*:\s*[A-Z](?:\s*·\s*\d+\s*:\s*[A-Z])*|[A-Z])$/u;

export function prepareStudyResponse(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Provider returned an empty response');
  if (QUESTIONNAIRE_PATTERN.test(text)) return text;
  return capWords(text, 60);
}

export function capWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}
