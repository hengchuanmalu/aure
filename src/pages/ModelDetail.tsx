import { AlbumCard } from '@/ui/AlbumCard';
import { AlbumViewSwitch } from "@/ui/AlbumViewSwitch";
import { Empty } from '@/ui/Empty';
import { avatarCrop } from "@/domain/avatar-crop";
import { backgroundCrop } from "@/domain/background-crop";
import { socialLinkName,websiteUrl } from "@/domain/social-links";
import { openWebsite } from "@/infrastructure/platform";
import { useData } from '@/state/data-context';
import { ContinuousLoader } from "@/ui/ContinuousLoader";
import { ImageLightbox } from "@/ui/ImageLightbox";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { ModelBackground } from "@/ui/ModelBackground";
import { SocialIcon } from "@/ui/SocialIcon";
import { VirtualGrid } from "@/ui/VirtualGrid";
import { ArrowLeft,ChevronDown,ChevronUp } from "lucide-react";
import { useLayoutEffect,useRef,useState } from "react";
import { Link,useParams,useSearchParams } from "react-router-dom";

export default function ModelDetail() {
  const { id } = useParams(),
    { db, page, notice } = useData();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "cover" ? "cover" : "stack";
  const [imageOpen, setImageOpen] = useState<"avatar" | "background" | null>(
    null,
  );
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [textOverflows, setTextOverflows] = useState(false);
  const profileContent = useRef<HTMLDivElement>(null);
  const m = db.models.find((m) => m.id === id);
  const expanded = expandedModel === id;
  useLayoutEffect(() => {
    const element = profileContent.current;
    if (!element) return;
    const measure = () =>
      setTextOverflows(
        element.scrollHeight >
          parseFloat(getComputedStyle(element).lineHeight) * 3 + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [m?.id, m?.bio, m?.fields, m?.links, expanded]);
  if (!m) return page?.refreshing
    ? <div className="loading" role="status">正在读取模特资料…</div>
    : <Empty title="模特不存在" />;
  const albums = db.albums.filter((a) => a.modelIds.includes(m.id));
  const visibleFields = m.fields.filter((field) => field.value.trim());
  const socialLinks = m.links.filter((link) => websiteUrl(link.url));
  const hasContent =
    !!m.bio.trim() || visibleFields.length > 0 || socialLinks.length > 0;
  return (
    <>
      <div className="backline">
        <Link to="/models">
          <ArrowLeft /> 返回模特
        </Link>
      </div>
      <section
        className="model-hero"
        data-expanded={expanded}
        data-has-background={!!m.background}
        aria-label="模特资料"
      >
        {m.background && (
          <button
            className="model-backdrop profile-background-trigger"
            aria-label="查看背景大图"
            onClick={() => setImageOpen("background")}
          >
            <ModelBackground model={m} />
          </button>
        )}
        <div className="model-info">
          <div className="model-identity">
            <button
              className="profile-image-trigger"
              aria-label="查看头像大图"
              disabled={!m.avatar}
              onClick={() => setImageOpen("avatar")}
            >
              <ModelAvatar className="profile-avatar" model={m} />
            </button>
            <div>
              {m.alias && <span className="content-label">{m.alias}</span>}
              <h1>{m.name}</h1>
            </div>
          </div>
          {hasContent && (
            <div className="model-description">
              <div
                ref={profileContent}
                id={`model-details-${m.id}`}
                className="profile-content"
                data-overflows={textOverflows}
                inert={textOverflows && !expanded}
              >
                {m.bio.trim() && (
                  <p id={`model-biography-${m.id}`} className="biography">
                    {m.bio}
                  </p>
                )}
                {visibleFields.length > 0 && (
                  <div className="profile-fields">
                    {[...new Set(visibleFields.map((f) => f.group))].map(
                      (g) => (
                        <section key={g}>
                          {g && g !== "详细资料" && <h3>{g}</h3>}
                          <div>
                            {visibleFields
                              .filter((f) => f.group === g)
                              .map((f) => (
                                <p className="profile-field" key={f.id}>
                                  <span className="profile-field-label">
                                    {f.label}：
                                  </span>
                                  <span className="profile-field-value">
                                    {f.value}
                                  </span>
                                </p>
                              ))}
                          </div>
                        </section>
                      ),
                    )}
                  </div>
                )}
                {socialLinks.length > 0 && (
                  <div className="profile-social-links" aria-label="社交账号">
                    {socialLinks.map((l, i) => (
                      <a
                        className="profile-social-link"
                        key={i}
                        href={websiteUrl(l.url)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => {
                          if ("__TAURI_INTERNALS__" in window) {
                            event.preventDefault();
                            void openWebsite(l.url).catch(() =>
                              notice("无法打开链接，请检查默认浏览器设置"),
                            );
                          }
                        }}
                      >
                        <SocialIcon url={l.url} /> {socialLinkName(l)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {textOverflows && (
                <div className="profile-content-actions">
                  <button
                    type="button"
                    className="profile-expand"
                    aria-expanded={expanded}
                    aria-controls={`model-details-${m.id}`}
                    onClick={() => setExpandedModel(expanded ? null : m.id)}
                  >
                    {expanded ? "收起" : "展开更多"}
                    {expanded ? (
                      <ChevronUp aria-hidden="true" />
                    ) : (
                      <ChevronDown aria-hidden="true" />
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <div className="page-pad">
        <section aria-label="关联写真集">
          <div className="section-title">
            <h2>关联写真集 · {page?.total ?? albums.length}</h2>
            <AlbumViewSwitch
              value={view}
              onChange={(value) =>
                setParams((previous) => {
                  const next = new URLSearchParams(previous);
                  if (value === "cover") next.set("view", "cover");
                  else next.delete("view");
                  return next;
                })
              }
            />
          </div>
          <VirtualGrid
            className={`album-grid ${view === "cover" ? "cover-grid" : ""}`}
            transitionKey={view}
            items={albums}
            render={(a) => (
              <AlbumCard key={a.id} album={a} variant={view} transitionView />
            )}
          />
          <ContinuousLoader />
        </section>
        {!albums.length && (
          <p className="muted">尚未关联写真集，可在「编辑资料」中添加。</p>
        )}
      </div>
      {imageOpen && (
        <ImageLightbox
          src={imageOpen === "avatar" ? m.avatar : m.background}
          title={`${m.name} · ${imageOpen === "avatar" ? "头像" : "背景"}`}
          circular={imageOpen === "avatar"}
          aspectRatio={16 / 9}
          crop={imageOpen === "avatar" ? avatarCrop(m) : backgroundCrop(m)}
          onClose={() => setImageOpen(null)}
        />
      )}
    </>
  );
}
