/* eslint-env node */

export function countWords(text) {
  const matches = String(text || '').match(/\S+/g);
  return matches ? matches.length : 0;
}

const GERMAN_WORDS = new Set([
  'der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'einen', 'für', 'wird',
  'werden', 'sie', 'auf', 'sich', 'den', 'dem', 'des', 'zu', 'im', 'oder', 'wir', 'auch',
  'wie', 'bei', 'aus', 'nach', 'kann', 'sind', 'von', 'wenn', 'diese', 'dieser', 'noch',
  'warum', 'was', 'ich', 'mein', 'meine', 'funktioniert', 'aufgabe', 'schreiben', 'gibt'
]);

const ENGLISH_WORDS = new Set([
  'the', 'and', 'is', 'of', 'to', 'in', 'that', 'it', 'for', 'with', 'are', 'this', 'be',
  'you', 'not', 'as', 'on', 'can', 'an', 'by', 'or', 'from', 'which', 'what', 'how', 'why',
  'does', 'do', 'my', 'when', 'will', 'should', 'there', 'their', 'write', 'task', 'work'
]);

export function detectLanguage(text) {
  const words = String(text || '').toLowerCase().match(/[a-zäöüß]+/g) || [];
  let german = 0;
  let english = 0;
  for (const word of words) {
    if (GERMAN_WORDS.has(word)) german += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }
  if (/[äöüß]/.test(String(text).toLowerCase())) german += 1;
  if (german + english < 2) return 'unknown';
  if (german >= english * 1.5) return 'de';
  if (english >= german * 1.5) return 'en';
  return 'unknown';
}

const KEYWORD_HEADING = /^(?:aufgabe|teilaufgabe|übung|uebung|übungsblatt|exercise|task|kapitel|chapter|abschnitt|section|lektion|lesson|woche|week|vorlesung|lecture|beispiel|example)\s*\d+[a-z]?(?:[.):]|\s|$)/i;
const NUMBERED_HEADING = /^\d+(?:\.\d+){0,3}\.?\s+[A-ZÄÖÜ][^.!?:]{0,70}$/;

export function headingLevel(line) {
  const text = String(line || '').trim();
  if (!text || text.length > 100) return 0;
  if (KEYWORD_HEADING.test(text)) return 2;
  if (NUMBERED_HEADING.test(text) && countWords(text) <= 10) {
    return /^\d+\.?\s/.test(text) ? 1 : 2;
  }
  return 0;
}

export function cleanTitle(fileName) {
  return String(fileName || 'Untitled')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function guessWeek(fileName) {
  const name = String(fileName || '').toLowerCase();
  const match = name.match(/(?:woche|week|wk|blatt|sheet|übung|uebung|ubung|exercise|lecture|vorlesung|vl|lektion|kapitel|chapter)[\s_-]*0*(\d{1,2})(?!\d)/i);
  if (!match) return null;
  const week = Number(match[1]);
  return week >= 0 && week <= 20 ? week : null;
}

export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9("„])/)
    .map((part) => part.trim())
    .filter(Boolean);
}
