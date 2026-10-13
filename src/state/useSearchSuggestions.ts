import { useData } from '@/state/data-context';
import type { SearchSuggestion } from '@/domain/search';
import { useEffect, useRef, useState } from 'react';

export function useSearchSuggestions(query: string, enabled: boolean) {
  const { suggest, db } = useData();
  const service = useRef(suggest);
  service.current = suggest;
  const [result, setResult] = useState<{
    query: string;
    items: SearchSuggestion[];
    error?: boolean;
    albums?: typeof db.albums;
    models?: typeof db.models;
    tags?: typeof db.tags;
    groups?: typeof db.groups;
  }>({ query: '', items: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !query.trim()) return;
    let alive = true;
    // Coalesce typing, and invalidate the previous request before this delay.
    const timer = setTimeout(() => {
      void service.current(query).then(items => {
        if (alive) setResult({ query, items, albums: db.albums, models: db.models, tags: db.tags, groups: db.groups });
      }).catch(() => {
        if (alive) setResult({ query, items: [], error: true, albums: db.albums, models: db.models, tags: db.tags, groups: db.groups });
      });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, enabled, retry, db.albums, db.models, db.tags, db.groups]);
  const current = result.query === query && result.albums === db.albums && result.models === db.models && result.tags === db.tags && result.groups === db.groups;
  return { items: current && enabled ? result.items : [], loading: enabled && !current,
    error: enabled && current && !!result.error, retry: () => { setResult({ query: '', items: [] }); setRetry(value => value + 1); } };
}
