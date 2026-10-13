export type SearchKind = 'album' | 'model' | 'tag';
export type SearchSuggestion = {
  kind: SearchKind;
  id: string;
  name: string;
  detail: string;
  thumbnail?: string;
};

/** Keep full-width Latin/numbers equivalent without altering stored names. */
export function normalizeSearch(value: string) {
  return Array.from(value, char => {
    const code = char.codePointAt(0)!;
    return code === 0x3000 ? ' ' : code >= 0xff01 && code <= 0xff5e
      ? String.fromCodePoint(code - 0xfee0) : char;
  }).join('').toLowerCase().trim().replace(/\s+/gu, ' ');
}
export function searchTerms(query: string) {
  return normalizeSearch(Array.from(query).slice(0, 120).join('')).split(' ').filter(Boolean);
}
export function allowLooseSearch(term: string) {
  return !/^\d+$/u.test(term) && Array.from(term).length >= (/^[\x00-\x7f]+$/u.test(term) ? 3 : 2);
}

/** Reserve space for each entity type, then fill spare slots by relevance. */
export function selectSuggestions<T extends SearchSuggestion>(ranked: T[]) {
  const quota = { album: 4, model: 2, tag: 2 };
  const selected = new Set<T>();
  for (const item of ranked) if (quota[item.kind]-- > 0) selected.add(item);
  for (const item of ranked) {
    if (selected.size >= 8) break;
    selected.add(item);
  }
  return ranked.filter(item => selected.has(item));
}

/** Original UTF-16 offsets: display text is never replaced by normalized text. */
export function searchHighlights(text: string, query: string): [number, number][] {
  let normalized = '';
  const offsets: [number, number][] = [];
  let offset = 0;
  for (const char of text) {
    const value = normalizeSearch(char) || (char.trim() ? char : ' ');
    normalized += value;
    for (let i = 0; i < value.length; i++) offsets.push([offset, offset + char.length]);
    offset += char.length;
  }
  const ranges: [number, number][] = [];
  for (const term of searchTerms(query)) {
    let start = normalized.indexOf(term);
    if (start < 0 && allowLooseSearch(term)) {
      let position = 0;
      const hits: number[] = [];
      for (const char of term) {
        position = normalized.indexOf(char, position);
        if (position < 0) { hits.length = 0; break; }
        hits.push(position);
        position += char.length;
      }
      for (const hit of hits) if (offsets[hit]) ranges.push(offsets[hit]);
    }
    while (start >= 0) {
      ranges.push([offsets[start][0], offsets[start + term.length - 1][1]]);
      start = normalized.indexOf(term, start + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= range[0]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
