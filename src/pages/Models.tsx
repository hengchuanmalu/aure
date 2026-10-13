import { Empty } from '@/ui/Empty';
import { ModelsGrid } from '@/ui/ModelsGrid';
import { indexLetters,modelInitial } from "@/domain/model-index";
import { ModelEditor } from '@/features/models/ModelEditor';
import { useData } from '@/state/data-context';
import { useEffect,useMemo,useRef,useState } from "react";
import { createPortal } from 'react-dom';
import { useNavigate,useSearchParams } from "react-router-dom";

export default function Models() {
  const { db } = useData();
  const [params, setParams] = useSearchParams();
  const adding = params.get("create") === "1";
  const setAdding = (value: boolean) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set("create", "1");
    else next.delete("create");
    return next;
  }, { replace: true });
  const nav = useNavigate();
  const [selectedLetter, setSelectedLetter] = useState('');
  const pageRoot = useRef<HTMLDivElement>(null);
  const [indexHovered, setIndexHovered] = useState(false);
  const [indexFocused, setIndexFocused] = useState(false);
  const indexVisible = indexHovered || indexFocused;
  const models = useMemo(() => db.models
    .map(model => ({ id: model.id, model, letter: modelInitial(model.name) }))
    .sort((a, b) => indexLetters.indexOf(a.letter) - indexLetters.indexOf(b.letter) || a.model.name.localeCompare(b.model.name, 'zh-CN')), [db.models]);
  const availableLetters = new Set(models.map(item => item.letter));
  const visibleModels = selectedLetter ? models.filter(item => item.letter === selectedLetter) : models;
  const selectLetter = (letter: string) => {
    setSelectedLetter(letter);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  useEffect(() => {
    if (!selectedLetter) return;
    const content = pageRoot.current?.closest('.page-content');
    if (!content) return;
    const clearOnBlankClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('a, button, input, select, textarea, [role="button"], [role="link"], [contenteditable]')) return;
      setSelectedLetter('');
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    // Listen on the content area so the empty space below a short list also works.
    content.addEventListener('click', clearOnBlankClick);
    return () => content.removeEventListener('click', clearOnBlankClick);
  }, [selectedLetter]);
  const indexZone = useRef<HTMLDivElement>(null);
  const wheelState = useRef({ selectedLetter, letters: indexLetters.filter(letter => availableLetters.has(letter)) });
  wheelState.current = { selectedLetter, letters: indexLetters.filter(letter => availableLetters.has(letter)) };
  useEffect(() => {
    const zone = indexZone.current;
    if (!zone) return;
    let accumulated = 0, lastTime = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastTime > 200 || Math.sign(accumulated) !== Math.sign(event.deltaY)) accumulated = 0;
      accumulated += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      if (Math.abs(accumulated) < 45 || now - lastTime < 140) return;
      const { letters, selectedLetter } = wheelState.current;
      if (!letters.length) return;
      const current = letters.indexOf(selectedLetter);
      const next = current < 0 ? (accumulated > 0 ? 0 : letters.length - 1) : Math.max(0, Math.min(letters.length - 1, current + Math.sign(accumulated)));
      accumulated = 0; lastTime = now;
      wheelState.current.selectedLetter = letters[next];
      selectLetter(letters[next]);
    };
    zone.addEventListener('wheel', wheel, { passive: false });
    return () => zone.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div ref={pageRoot} className="page-pad models-page">
      <div className="page-heading">
        <h1><button className="models-title" type="button" aria-label="显示全部模特" onClick={() => selectLetter('')}>模特</button></h1>
      </div>
      {visibleModels.length ? (
          <ModelsGrid items={visibleModels} />
      ) : (
        <Empty title="没有找到模特" />
      )}
          {createPortal(<div ref={indexZone} className="model-index-zone" tabIndex={0} role="group" aria-label="显示模特字母索引"
            onPointerEnter={() => setIndexHovered(true)} onPointerLeave={() => setIndexHovered(false)}
            onPointerDownCapture={() => setIndexFocused(false)}
            onFocusCapture={event => { if (event.target.matches(':focus-visible')) setIndexFocused(true); }}
            onKeyDownCapture={() => setIndexFocused(true)}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIndexFocused(false); }}>
            <nav className="model-index" aria-label="模特字母索引" data-visible={indexVisible} inert={!indexVisible}>
              {indexLetters.map(letter => <button key={letter} type="button" disabled={!availableLetters.has(letter)}
                aria-label={`筛选 ${letter} 开头的模特`} aria-pressed={selectedLetter === letter}
                onClick={() => selectLetter(letter)}>{letter}</button>)}
            </nav>
          </div>, document.body)}
      {adding && (
        <ModelEditor
          onClose={() => setAdding(false)}
          onSaved={(id) => nav(`/models/${id}`)}
        />
      )}
    </div>
  );
}
