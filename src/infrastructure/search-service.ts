import { matchSorterWithRankInfo, rankings } from 'match-sorter';
import { catalog } from '@/domain/catalog';
import { allowLooseSearch, normalizeSearch, searchTerms, selectSuggestions, type SearchSuggestion } from '@/domain/search';
import type { Database } from '@/domain/types';
import { native } from '@/infrastructure/tauri-bridge';

type SearchDocument = SearchSuggestion & { primary: string[]; related: string[] };
function documents(db: Database): SearchDocument[] {
  const index = catalog(db);
  return [
    ...db.albums.map(album => {
      const models = album.modelIds.map(id => index.models.get(id)?.name || '').filter(Boolean);
      const tags = [...(index.summaries.get(album.id)?.tags || [])].map(id => index.tags.get(id)?.name || '').filter(Boolean);
      return { kind: 'album' as const, id: album.id, name: album.name,
        detail: [album.number, ...models, ...tags].filter(Boolean).join(' · '), thumbnail: album.cover,
        primary: [album.name, album.number || ''], related: [...models, ...tags, album.subtitle, album.description] };
    }),
    ...db.models.map(model => ({ kind: 'model' as const, id: model.id, name: model.name,
      detail: model.alias || `${model.albumCount ?? index.modelCounts.get(model.id) ?? 0} 本写真`, thumbnail: model.avatar,
      primary: [model.name, model.alias], related: [] })),
    ...db.tags.map(tag => ({ kind: 'tag' as const, id: tag.id, name: tag.name,
      detail: db.groups.find(group => group.id === tag.groupId)?.name || '标签',
      primary: [tag.name, ''], related: [] })),
  ].sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** match-sorter is confined to the adapter; both runtimes share the same tiers. */
export function suggestFromDatabase(db: Database, query: string): SearchSuggestion[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const ranked = documents(db).flatMap((item, index) => {
    const primary = item.primary.map(normalizeSearch), related = item.related.map(normalizeSearch);
    const scores: { rank: number; key: number }[] = [];
    for (const term of terms) {
      const best = matchSorterWithRankInfo(primary, term, {
        keepDiacritics: true,
        threshold: allowLooseSearch(term) ? rankings.MATCHES : rankings.CONTAINS,
        baseSort: (a, b) => a.index - b.index,
      })[0];
      const relation = related.findIndex(value => value.includes(term));
      const score = best ? { rank: best.rank, key: best.index } : { rank: 0, key: 0 };
      if (relation >= 0 && score.rank < 2) { score.rank = 2; score.key = 2; }
      if (!score.rank) return [];
      scores.push(score);
    }
    return [{ item, scores, index }];
  }).sort((a, b) => {
    for (let i = 0; i < terms.length; i++) {
      const difference = b.scores[i].rank - a.scores[i].rank || a.scores[i].key - b.scores[i].key;
      if (difference) return difference;
    }
    return a.index - b.index;
  });
  return selectSuggestions(ranked.map(({ item: { primary: _primary, related: _related, ...item } }) => item));
}

export const readSearchSuggestions = (query: string) =>
  native<SearchSuggestion[]>('catalog_suggestions', { query });
