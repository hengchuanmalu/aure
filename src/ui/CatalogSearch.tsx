import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { Search, Tag, ArrowUpRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchHighlights, type SearchKind, type SearchSuggestion } from '@/domain/search';
import { useSearchSuggestions } from '@/state/useSearchSuggestions';
import { Input } from '@/ui/SearchInput';
import { Photo } from '@/ui/Photo';

const label = '搜索写真、模特或标签';
const groups: [SearchKind, string][] = [['album', '写真集'], ['model', '模特'], ['tag', '标签']];
function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = searchHighlights(text, query);
  let previous = 0;
  const parts = ranges.map(([start, end]) => {
    const part = <span key={start}>{text.slice(previous, start)}<mark>{text.slice(start, end)}</mark></span>;
    previous = end;
    return part;
  });
  return <>{parts}{text.slice(previous)}</>;
}

export function CatalogSearch() {
  const input = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selection, setSelection] = useState('__none__');
  const allowSelection = useRef(false);
  const composition = useRef(false);
  const editedRoute = useRef<string | undefined>(undefined);
  const content = useRef<HTMLDivElement>(null);
  const open = focused && !!query.trim() && !dismissed && !composing;
  const { items, loading, error, retry } = useSearchSuggestions(query, open);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !composition.current &&
        !document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
        setFocused(true);
        setDismissed(false);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useLayoutEffect(() => {
    // Hash navigation can precede a lazy route's commit. Text typed for that
    // destination already belongs to it and must survive the later URL sync.
    if (editedRoute.current !== location.pathname + location.search) {
      setQuery(new URLSearchParams(location.search).get('q') || '');
      setDismissed(true);
      setSelection('__none__');
    }
    editedRoute.current = undefined;
  }, [location.pathname, location.search]);
  const editQuery = (value: string) => {
    editedRoute.current = window.location.hash.replace(/^#/, '') || '/';
    setQuery(value); setDismissed(false); setSelection('__none__'); allowSelection.current = false;
  };
  const close = () => { setDismissed(true); allowSelection.current = false; setSelection('__none__'); };
  const submit = () => {
    if (composition.current) return;
    close();
    const tagsView = location.pathname === '/tags';
    const params = new URLSearchParams(tagsView ? location.search : '');
    params.delete('page');
    query.trim() ? params.set('q', query.trim()) : params.delete('q');
    navigate(`${tagsView ? '/tags' : '/library'}${params.size ? `?${params}` : ''}`);
  };
  const choose = (item: SearchSuggestion) => {
    if (composition.current) return;
    close();
    navigate(item.kind === 'album' ? `/album/${encodeURIComponent(item.id)}`
      : item.kind === 'model' ? `/models/${encodeURIComponent(item.id)}`
      : `/tags?tag=${encodeURIComponent(item.id)}`);
  };
  return <Popover.Root open={open} onOpenChange={value => { if (!value) close(); }}>
    <Command className="search-form" shouldFilter={false} value={selection === '__none__' ? `__none__:${query}` : selection} vimBindings={false}
      onValueChange={value => { if (allowSelection.current) setSelection(value); }}>
      <form role="search" onSubmit={event => { event.preventDefault(); submit(); }}
        onKeyDown={event => {
          if (composition.current || event.nativeEvent.isComposing || event.keyCode === 229) {
            // Let a real IME confirm its composition; block only a pending
            // composition's plain Enter from submitting the surrounding form.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            if (!open) { setDismissed(false); event.preventDefault(); }
            else {
              allowSelection.current = true;
              if (event.key === 'ArrowUp' && selection === '__none__') {
                setSelection('__search__');
                event.preventDefault();
              }
            }
          } else if (event.key === 'Enter' && (!open || selection === '__none__' || !items.some(item => `${item.kind}:${item.id}` === selection) && !['__search__', '__retry__'].includes(selection))) {
            event.preventDefault(); submit();
          } else if (event.key === 'Home' || event.key === 'End') {
            // Preserve the input's caret shortcuts; arrows alone navigate results.
            event.stopPropagation();
          }
        }}>
        <Popover.Anchor asChild><div className="catalog-search-anchor">
          {/* External queries own filtering; keep cmdk's internal search inert. */}
          <Command.Input asChild value="" onValueChange={editQuery}>
            <Input ref={input} contentBefore={<Search />} contentAfter={<kbd>Ctrl K</kbd>}
              value={query} placeholder={label} aria-label={label} autoComplete="off" spellCheck={false}
              aria-expanded={open} maxLength={240}
              onFocus={() => { setFocused(true); setDismissed(false); }}
              onBlur={event => {
                if (!content.current?.contains(event.relatedTarget as Node)) { setFocused(false); close(); }
              }}
              onCompositionStart={() => { composition.current = true; setComposing(true); }}
              onCompositionEnd={event => {
                composition.current = false; setComposing(false); editQuery(event.currentTarget.value);
              }} />
          </Command.Input>
        </div></Popover.Anchor>
        <Popover.Portal>
          <Popover.Content ref={content} data-slot="popover-content" className="search-suggestions" side="bottom" align="start" sideOffset={8} collisionPadding={12}
            aria-label="搜索候选" aria-hidden={!open} inert={!open}
            onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
            onInteractOutside={event => { if (event.target === input.current || input.current?.parentElement?.contains(event.target as Node)) event.preventDefault(); }}
            onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }}
            onPointerMove={() => { allowSelection.current = true; }}>
            <Command.List className="search-suggestion-list" aria-label="可能的搜索结果" aria-busy={loading}>
              {loading && <div className="search-message" role="status">正在搜索…</div>}
              {error && <>
                <div className="search-message" role="alert">暂时无法读取搜索结果</div>
                <Command.Item value="__retry__" onSelect={retry} className="search-suggestion-action">重试</Command.Item>
              </>}
              {!loading && !error && !items.length && <div className="search-message" role="status">没有找到匹配的内容</div>}
              {groups.map(([kind, heading]) => {
                const entries = items.filter(item => item.kind === kind);
                return entries.length > 0 && <Command.Group key={kind} heading={heading}>
                  {entries.map(item => <Command.Item key={`${kind}:${item.id}`} value={`${kind}:${item.id}`} className="search-suggestion" onSelect={() => choose(item)}>
                    <span className={`search-suggestion-image search-suggestion-image--${kind}`}>
                      {kind === 'tag' ? <Tag /> : item.thumbnail ? <Photo src={item.thumbnail} retryable={false} /> : <Search />}
                    </span>
                    <span className="search-suggestion-text"><strong><Highlight text={item.name} query={query} /></strong>
                      {item.detail && <small><Highlight text={item.detail} query={query} /></small>}
                    </span>
                  </Command.Item>)}
                </Command.Group>;
              })}
              <Command.Item value="__search__" className="search-suggestion-action" onSelect={submit}>
                <Search /><span>搜索“{query.trim()}”</span><ArrowUpRight />
              </Command.Item>
            </Command.List>
          </Popover.Content>
        </Popover.Portal>
      </form>
    </Command>
  </Popover.Root>;
}
