import { AlbumCard } from "@/ui/AlbumCard";
import { Empty } from "@/ui/Empty";
import { ModelCard } from "@/ui/ModelCard";
import { Photo } from "@/ui/Photo";
import { Rail } from "@/ui/Rail";
import { avatarImageStyle } from "@/domain/avatar-crop";
import { type Album } from "@/domain/types";
import { useData } from "@/state/data-context";
import { AlbumShelf } from "@/ui/AlbumShelf";
import { FeaturedRecommendations } from "@/ui/FeaturedRecommendations";
import { ModelFilters } from "@/ui/ModelFilters";
import { TagLabel } from "@/ui/TagLabel";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function Home() {
  const { db, page } = useData();
  const [params, setParams] = useSearchParams();
  const [localModel, setLocalModel] = useState("");
  const model = page ? params.get("model") || "" : localModel;
  const setModel = (value: string) =>
    page ? setParams(value ? { model: value } : {}) : setLocalModel(value);
  // The native home snapshot also includes favorite/recent shelf albums. Filter
  // recommendations using its own conditions while the next query is pending.
  const resultModel = page?.query?.model ?? model;
  const albums = db.albums.filter((a) => !resultModel || a.modelIds.includes(resultModel));
  const recent = [...new Set(db.recent.map((r) => r.albumId))]
    .map((id) => db.albums.find((a) => a.id === id))
    .filter((a): a is Album => !!a);
  return (
    <div className="page-pad discovery">
      <div className="page-heading">
        <div>
          <h1>发现</h1>
        </div>
        <span className="collection-note">
          {page?.albumTotal ?? db.albums.length} 本写真集 <span>·</span>{" "}
          {page?.modelTotal ?? db.models.length} 位模特
        </span>
      </div>
      <ModelFilters value={model} onChange={setModel} />
      <section className="featured-section" aria-label="精选写真">
        {!albums.length && (
          <div className="section-title">
            <h2>
              {model
                ? db.models.find((m) => m.id === model)?.name + "的写真"
                : "推荐"}
            </h2>
          </div>
        )}
        {albums.length ? (
          <FeaturedRecommendations
            albums={albums}
            coverRevisions={page?.coverRevisions}
            title={
              model
                ? `${db.models.find((m) => m.id === model)?.name ?? "模特"}的写真`
                : "推荐"
            }
          />
        ) : (
          <Empty
            title={model ? "这位模特还没有关联写真集" : "还没有写真集"}
            text={model ? undefined : "从你的写真文件夹导入第一套收藏。"}
          >
            {!model && (
              <Link className="text-action" to="/library?create=1">
                导入写真
              </Link>
            )}
          </Empty>
        )}
      </section>
      <section className="people-section" aria-label="按模特浏览">
        <div className="section-title">
          <h2>
            模特 <small>{db.models.length} 位</small>
          </h2>
          <Link className="quiet-link" to="/models">
            查看全部
          </Link>
        </div>
        <div className="people-strip">
          {db.models.slice(0, 12).map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      </section>
      <AlbumShelf
        albums={albums}
        link={model ? `/library?model=${model}` : "/library"}
      />
      <Rail title="最近更新" link="/library" hideScrollbar>
        {[...db.albums]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 8)
          .map((a) => (
            <AlbumCard key={a.id} album={a} highResolution />
          ))}
      </Rail>
      <Rail title="最近浏览" link="/recent" hideScrollbar>
        {recent.length ? (
          recent.map((a) => <AlbumCard key={a.id} album={a} highResolution />)
        ) : (
          <p className="rail-empty">打开一组写真，下次从这里继续。</p>
        )}
      </Rail>
      <Rail title="收藏" link="/favorites">
        {db.albums.some((a) => a.favorite) ? (
          db.albums
            .filter((a) => a.favorite)
            .slice(0, 8)
            .map((a) => <AlbumCard key={a.id} album={a} highResolution />)
        ) : (
          <p className="rail-empty">收藏的写真集会出现在这里。</p>
        )}
      </Rail>
      <section className="rail-section">
        <div className="section-title">
          <h2>按标签浏览</h2>
          <Link to="/tags/manage" className="text-action">
            管理标签 <ArrowRight size={16} />
          </Link>
        </div>
        <div className="tag-discover">
          {db.groups.map((g) => {
            const tag = db.tags.find((t) => t.groupId === g.id);
            const related =
              tag && db.albums.find((a) => a.tags.includes(tag.id));
            return (
              <Link
                key={g.id}
                to={tag ? `/library?tag=${tag.id}` : "/tags/manage"}
              >
                {related && (
                  <Photo
                    retryable={false}
                    src={related.cover}
                    style={
                      related.coverCrop
                        ? avatarImageStyle(related.coverCrop)
                        : undefined
                    }
                    resolutionZoom={related.coverCrop?.zoom}
                    highResolution
                  />
                )}
                <span>
                  {g.name}
                  <small className="tag-discover-labels">
                    {db.tags
                      .filter((t) => t.groupId === g.id)
                      .slice(0, 3)
                      .map((t) => (
                        <TagLabel key={t.id}>{t.name}</TagLabel>
                      ))}
                    {!db.tags.some((t) => t.groupId === g.id) && "暂无标签"}
                  </small>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
