const ARABIC_ARTICLE_PREFIXES = /\b(?:al|as|an|ar|at|ad|az|ash|ath|adh)-/giu;

export function formatScholarName(value: string): string {
  return value
    .replace(/\bb\.\s+/giu, 'Ibn ')
    .replace(ARABIC_ARTICLE_PREFIXES, (match) => match.charAt(0).toUpperCase() + match.slice(1));
}
