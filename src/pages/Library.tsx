import { AlbumCard } from "@/ui/AlbumCard";
import { AlbumViewSwitch } from "@/ui/AlbumViewSwitch";
import { Empty } from "@/ui/Empty";
import {
  albumSortOptions,
  compareAlbums,
  defaultSortDirection,
  type AlbumSort,
} from "@/domain/album-sort";
import { searchAlbums } from "@/domain/catalog";
import { AlbumEditor } from "@/features/albums/AlbumEditor";
import { useData } from "@/state/data-context";
import { Button } from "@/ui/ActionButton";
import { ContinuousLoader } from "@/ui/ContinuousLoader";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { ModelFilters } from "@/ui/ModelFilters";
import { MotionCollapse } from "@/ui/MotionCollapse";
import { SortField } from "@/ui/SortField";
import { TagBrowseFilters } from "@/ui/TagBrowseFilters";
import { TagLabel } from "@/ui/TagLabel";
import { VirtualGrid } from "@/ui/VirtualGrid";
import { ArrowUpRight, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export default function Library({ tagsView = false }: { tagsView?: boolean }) {
  const { db, page } = useData();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const query = params.get("q") || "",
    tag = params.getAll("tag"),
    model = params.get("model") || "",
    kind = params.get("kind") || "all",
    sort: AlbumSort =
      params.get("sort") === "name"
        ? "name"
        : params.get("sort") === "created"
          ? "created"
          : "updated",
    view = params.get("view") === "cover" ? "cover" : "stack";
  const selectedModel = db.models.find((m) => m.id === model);
  const direction =
    params.get("order") === "asc"
      ? "asc"
      : params.get("order") === "desc"
        ? "desc"
        : defaultSortDirection(sort);
  const setTags = (ids: string[]) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("tag");
      next.delete("page");
      ids.forEach((id) => next.append("tag", id));
      return next;
    });
  const clearFilters = () =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const key of ["tag", "model", "kind", "page"]) next.delete(key);
      return next;
    });
  const setParam = (key: string, value: string) =>
    setParams((p) => {
      p.delete("page");
      value ? p.set(key, value) : p.delete(key);
      return p;
    });
  const albums = page
    ? db.albums
    : searchAlbums(db, query, tag, model, kind).sort((a, b) =>
        compareAlbums(a, b, sort, direction),
      );
  return (
    <div
      className={`page-pad library-page${tagsView ? " tag-browse-page" : ""}`}
    >
      <div className="page-heading">
        <div>
          <h1>{tagsView ? "标签" : "写真库"}</h1>
        </div>
        <div className="row library-toolbar">
          <AlbumViewSwitch
            value={view}
            onChange={(value) => setParam("view", value === "cover" ? "cover" : "")}
          />
          <SortField
            value={sort}
            direction={direction}
            options={albumSortOptions.map((option) => ({
              ...option,
              defaultDirection: defaultSortDirection(option.value),
            }))}
            onChange={(value, order) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("sort", value);
                next.set("order", order);
                next.delete("page");
                return next;
              })
            }
          />
        </div>
      </div>
      {tagsView ? (
        <TagBrowseFilters
          value={tag}
          onChange={setTags}
          model={model}
          onModelChange={(id) => setParam("model", id)}
        />
      ) : (
        <ModelFilters value={model} onChange={(id) => setParam("model", id)} />
      )}
      <AnimatePresence initial={false}>
        {selectedModel && !tagsView && (
          <MotionCollapse className="collection-context" key="model-context">
            <ModelAvatar model={selectedModel} />
            <div>
              <h2>{selectedModel.name}</h2>
              <p>
                {page?.total ?? albums.length} 本写真集 · {selectedModel.alias}
              </p>
            </div>
            <Link className="text-action" to={`/models/${selectedModel.id}`}>
              查看模特 <ArrowUpRight size={16} />
            </Link>
          </MotionCollapse>
        )}
      </AnimatePresence>
      {query && (
        <div className="search-summary">
          “{query}” 的搜索结果 · {page?.total ?? albums.length} 本{" "}
          <Button variant="ghost" onClick={() => setParam("q", "")}>
            清除搜索
          </Button>
        </div>
      )}
      <div className="library-results">
        <span>{tagsView ? "匹配结果" : model ? "关联写真" : "全部写真"}</span>
        <small aria-live="polite">
          {page?.total ?? albums.length} {tagsView ? "本写真集" : "本"}
        </small>
        {tagsView && (
          <div
            className="tag-result-filters"
            role="group"
            aria-label="已选筛选"
          >
            {tag.map((id) => (
              <Button
                key={id}
                variant="ghost"
                className="tag-result-chip"
                aria-label={`移除标签 ${db.tags.find((item) => item.id === id)?.name || id}`}
                onClick={() => setTags(tag.filter((value) => value !== id))}
              >
                <TagLabel>
                  {db.tags.find((item) => item.id === id)?.name || id}
                </TagLabel>
                <X />
              </Button>
            ))}
            {selectedModel && (
              <Button
                variant="ghost"
                className="tag-result-chip"
                aria-label={`移除模特 ${selectedModel.name}`}
                onClick={() => setParam("model", "")}
              >
                {selectedModel.name}
                <X />
              </Button>
            )}
            {(tag.length > 0 || model || kind !== "all") && (
              <Button
                variant="ghost"
                className="tag-clear-all"
                aria-label="清除全部筛选"
                onClick={clearFilters}
              >
                清除全部
              </Button>
            )}
          </div>
        )}
      </div>
      {albums.length ? (
        <VirtualGrid
          className={`album-grid ${view === "cover" ? "cover-grid" : ""}`}
          transitionKey={view}
          items={albums}
          render={(a, index) => (
            <AlbumCard
              key={a.id}
              album={a}
              variant={view}
              transitionView
              order={index}
            />
          )}
        />
      ) : (
        <Empty
          title={
            (page?.albumTotal ?? db.albums.length)
              ? "没有找到匹配的写真"
              : "还没有写真集"
          }
          text={
            (page?.albumTotal ?? db.albums.length)
              ? "试试其他关键词，或减少筛选条件。"
              : tagsView
                ? "在写真库添加写真，再为写真添加标签。"
                : "点击添加写真，再从文件夹导入你的照片。"
          }
        />
      )}
      <ContinuousLoader />
      {params.has("create") && (
        <AlbumEditor
          onClose={() =>
            setParams((p) => {
              p.delete("create");
              return p;
            })
          }
          onSaved={(id) => nav(`/album/${id}`)}
        />
      )}
    </div>
  );
}
