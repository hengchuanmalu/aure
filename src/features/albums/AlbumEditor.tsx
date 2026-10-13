import { ModelEditor } from "@/features/models/ModelEditor";
import type { PreparedAlbumImport } from "@/application/album-import";
import type { PreparedBatchImport } from "@/application/batch-album-import";
import { importAutomatically } from "@/application/automatic-album-import";
import { Confirm } from "@/ui/Confirm";
import { Modal } from "@/ui/Modal";
import { uid } from "@/domain/database";
import { type Album, type MediaItem, type ModelProfile } from "@/domain/types";
import { selectAlbumImport } from "@/infrastructure/folder-service";
import { readEntity } from "@/infrastructure/desktop-repository";
import { useData } from "@/state/data-context";
import { Button } from "@/ui/ActionButton";
import { AlbumCoverEditor } from "@/ui/AlbumCoverEditor";
import { HoverHint } from "@/ui/HoverHint";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { PagedItems } from "@/ui/PagedItems";
import { Input } from "@/ui/SearchInput";
import { TagLabel } from "@/ui/TagLabel";
import { Check, ChevronDown, FolderOpen, Plus, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Field } from "@/ui/Field";
import { TagPicker } from "@/ui/TagPicker";
import { AnimatePresence } from "motion/react";
import { MotionCollapse } from "@/ui/MotionCollapse";
type AlbumEditorProps = {
  album?: Album;
  initialDraft?: Album;
  preparedImport?: PreparedAlbumImport;
  onDraftSaved?: (album: Album) => void;
  onClose: () => void;
  onSaved?: (id: string) => void;
};

export function AlbumEditor(props: AlbumEditorProps) {
  const { page } = useData();
  const remote =
    !!page && !!props.album && !props.preparedImport && !props.onDraftSaved;
  const [prepared, setPrepared] = useState<Album>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const id = props.album?.id;
  useEffect(() => {
    if (!remote || !id) return;
    let alive = true;
    setError("");
    // Page snapshots deliberately omit complete media relationships. Do not
    // create a writable draft until the explicit entity read has succeeded.
    void readEntity<Album>("albums", id).then(
      (album) => {
        if (!alive) return;
        if (album) setPrepared(album);
        else setError("写真集已不存在，请刷新页面后重试");
      },
      () => {
        if (alive) setError("无法读取写真集，请重试");
      },
    );
    return () => {
      alive = false;
    };
  }, [remote, id, attempt]);
  if (!remote) return <AlbumEditorDraft {...props} />;
  if (prepared?.id === id)
    return <AlbumEditorDraft key={id} {...props} album={prepared} />;
  return (
    <Modal
      title="编辑写真集"
      wide
      className="album-editor-modal"
      onClose={props.onClose}
    >
      <p role={error ? "alert" : "status"}>{error || "正在读取写真集…"}</p>
      {error && <Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>}
    </Modal>
  );
}

function AlbumEditorDraft({
  album,
  onClose,
  onSaved,
  initialDraft,
  preparedImport,
  onDraftSaved,
}: AlbumEditorProps) {
  const { db, act, notice } = useData();
  const [importing, setImporting] = useState(false);
  const importBusy = useRef(false);
  const pendingImport = preparedImport;
  const retryImport = useRef<PreparedBatchImport | undefined>(undefined);
  const [addingModel, setAddingModel] = useState(false);
  const numberInputId = useId();
  const tagToggleId = useId();
  const tagOptionsId = useId();
  const [tagsOpen, setTagsOpen] = useState(false);
  const [initial] = useState<Album>(
    () =>
      album ||
      initialDraft ||
      preparedImport?.album || {
        id: uid(),
        name: "",
        subtitle: "",
        description: "",
        cover: "",
        mediaIds: [],
        tags: [],
        modelIds: [],
        favorite: false,
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      },
  );
  const [draft, set] = useState<Album>(structuredClone(initial)),
    [discard, setDiscard] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const edit = (p: Partial<Album>) => set((d) => ({ ...d, ...p }));
  const mediaById = new Map(
    (pendingImport?.media || db.media).map((item) => [item.id, item]),
  );
  const images = draft.mediaIds
    .map((id) => mediaById.get(id))
    .filter((item): item is MediaItem => item?.kind === "image");
  const tags = [
    ...db.tags,
    ...(pendingImport?.tags.filter(
      (t) => !db.tags.some((existing) => existing.id === t.id),
    ) || []),
  ];
  const groups = [
    ...db.groups,
    ...(pendingImport?.groups.filter(
      (g) => !db.groups.some((existing) => existing.id === g.id),
    ) || []),
  ];
  const extraModels =
    pendingImport?.models.filter(
      (m) => !db.models.some((existing) => existing.id === m.id),
    ) || [];
  const firstImage = images[0];
  const defaultCover = pendingImport
    ? pendingImport.album.cover
    : initial.cover || firstImage?.src || "";
  const close = () => {
    if (saving || importBusy.current) return;
    JSON.stringify(draft) !== JSON.stringify(initial)
      ? setDiscard(true)
      : onClose();
  };
  const chooseFolder = async () => {
    if (importBusy.current || saving) return;
    importBusy.current = true;
    setImporting(true);
    setError("");
    try {
      const prepared = retryImport.current || (await selectAlbumImport());
      if (!prepared) return;
      const result = await importAutomatically(prepared, (pending, album) =>
        act({ type: "importAlbum", pending, album }),
      );
      retryImport.current = result.retryable ? prepared : undefined;
      if (result.failures.length) {
        setError(
          `已导入 ${result.imported} 套，已跳过 ${result.duplicates} 套；${result.failures.length} 套未完成。${result.failures[0]}`,
        );
        return;
      }
      onClose();
      if (result.albumId) onSaved?.(result.albumId);
      if (result.duplicates)
        notice(
          `已导入 ${result.imported} 套，跳过 ${result.duplicates} 套已有写真`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      importBusy.current = false;
      setImporting(false);
    }
  };
  const save = async () => {
    if (saving || importBusy.current) return;
    if (!draft.name.trim()) {
      setError("请输入写真集名称");
      return;
    }
    setSaving(true);
    try {
      if (onDraftSaved) {
        onDraftSaved({ ...draft, name: draft.name.trim() });
        return;
      }
      await act(
        pendingImport
          ? { type: "importAlbum", pending: pendingImport, album: draft }
          : { type: "saveAlbum", album: draft },
      );
      onClose();
      onSaved?.(draft.id);
    } catch (e) {
      setError(
        pendingImport && e instanceof Error
          ? `无法保存：${e.message}`
          : "无法保存，请检查本地存储空间后重试",
      );
    } finally {
      setSaving(false);
    }
  };
  const modelOption = (m: ModelProfile) => (
    <button
      type="button"
      key={m.id}
      className="album-model-option"
      aria-label={`关联模特 ${m.name}`}
      aria-pressed={draft.modelIds.includes(m.id)}
      onClick={() =>
        edit({
          modelIds: draft.modelIds.includes(m.id)
            ? draft.modelIds.filter((id) => id !== m.id)
            : [...draft.modelIds, m.id],
        })
      }
    >
      <span className="album-model-avatar">
        {m.avatar ? (
          <ModelAvatar
            model={m}
            sourcePath={
              pendingImport?.media.find((item) => item.src === m.avatar)
                ?.sourcePath
            }
          />
        ) : (
          <UserRound />
        )}
        {draft.modelIds.includes(m.id) && (
          <span className="album-model-check">
            <Check />
          </span>
        )}
      </span>
      <span>{m.name}</span>
    </button>
  );
  return (
    <>
      <Modal
        title={album || onDraftSaved ? "编辑写真集" : "添加写真"}
        wide
        className="album-editor-modal"
        onClose={close}
        footer={
          <>
            <span role="alert" className="error">
              {error}
            </span>
            <Button
              className="album-editor-action"
              disabled={saving || importing}
              onClick={close}
            >
              {onDraftSaved ? "返回导入列表" : "取消"}
            </Button>
            <Button
              className="album-editor-action"
              variant="default"
              disabled={saving || importing}
              onClick={() => void save()}
            >
              {saving ? "正在保存…" : onDraftSaved ? "确认修改" : "保存"}
            </Button>
          </>
        }
      >
        <fieldset disabled={saving || importing} className="album-form">
          <AlbumCoverEditor
            album={draft}
            defaultCover={defaultCover}
            defaultCoverMediaId={
              pendingImport
                ? pendingImport.album.coverMediaId
                : initial.coverMediaId
            }
            defaultCrop={
              pendingImport ? pendingImport.album.coverCrop : initial.coverCrop
            }
            items={images}
            albumId={album?.id}
            localOnly={!!pendingImport}
            disabled={saving || importing}
            onChange={(cover, coverMediaId, coverCrop) =>
              edit({ cover, coverMediaId, coverCrop })
            }
          />
          <div className="album-form-right">
            <section className="album-info-section" aria-label="写真信息">
              <div className="album-section-heading">
                <h3>写真信息</h3>
                {!album && !onDraftSaved && (
                  <Button
                    variant="ghost"
                    icon={<FolderOpen />}
                    onClick={() => void chooseFolder()}
                  >
                    {importing
                      ? "正在导入…"
                      : retryImport.current
                        ? "重试导入"
                        : "从文件夹导入"}
                  </Button>
                )}
              </div>
              <div className="album-name-group">
                <Field
                  label="写真集名称"
                  placeholder="请输入写真集名称"
                  value={draft.name}
                  onChange={(name) => edit({ name })}
                />
                <div className="album-number-row">
                  <label htmlFor={numberInputId}>编号</label>
                  <Input
                    id={numberInputId}
                    value={draft.number || ""}
                    placeholder="可选"
                    onChange={(event) => edit({ number: event.target.value })}
                  />
                </div>
              </div>
              <div className="album-tags-row">
                <span className="album-tags-label">标签</span>
                <div className="album-tag-field" role="group" aria-label="标签">
                  <div className="album-selected-tags">
                    {draft.tags.map((id) => {
                      const tag = tags.find((t) => t.id === id);
                      return tag ? (
                        <button
                          type="button"
                          className="chip"
                          key={id}
                          aria-label={`移除标签 ${tag.name}`}
                          onClick={() =>
                            edit({ tags: draft.tags.filter((t) => t !== id) })
                          }
                        >
                          <TagLabel>{tag.name}</TagLabel>
                          <span aria-hidden="true">×</span>
                        </button>
                      ) : null;
                    })}
                  </div>
                  <Button
                    id={tagToggleId}
                    size="sm"
                    variant="ghost"
                    aria-expanded={tagsOpen}
                    aria-controls={tagOptionsId}
                    onClick={() => setTagsOpen(!tagsOpen)}
                  >
                    选择标签
                    <ChevronDown
                      className="tag-picker-arrow"
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </div>
              <AnimatePresence initial={false}>
                {tagsOpen && (
                  <MotionCollapse
                    key="album-tags"
                    className="album-tag-disclosure"
                    returnFocus={`[id="${tagToggleId}"]`}
                  >
                    <div id={tagOptionsId} className="album-tag-options">
                      {tags.length ? (
                        <TagPicker
                          value={draft.tags}
                          tags={tags}
                          groups={groups}
                          layout="list"
                          onChange={(tags) => edit({ tags })}
                        />
                      ) : (
                        <p className="muted">暂无标签</p>
                      )}
                    </div>
                  </MotionCollapse>
                )}
              </AnimatePresence>
              {draft.sourceFolderName && (
                <HoverHint text={draft.sourceFolderName}>
                  <p className="album-source muted">
                    原始文件夹：{draft.sourceFolderName}
                    {draft.declaredPhotoCount !== undefined
                      ? ` · 标注 ${draft.declaredPhotoCount}P`
                      : ""}
                    {draft.declaredSize ? ` · 标注 ${draft.declaredSize}` : ""}
                  </p>
                </HoverHint>
              )}
            </section>
            <section className="album-model-section" aria-label="关联模特">
              <div className="album-section-heading">
                <h3>关联模特</h3>
                <span className="album-count">
                  已关联 {draft.modelIds.length} 位
                </span>
              </div>
              <div
                className="album-model-scroll"
                tabIndex={0}
                role="group"
                aria-label="关联模特列表"
              >
                <PagedItems<ModelProfile>
                  kind="models"
                  className="album-model-grid"
                  label="关联模特"
                  items={db.models}
                  render={(m) =>
                    extraModels.some((extra) => extra.id === m.id)
                      ? null
                      : modelOption(m)
                  }
                >
                  {extraModels.map(modelOption)}
                  {!onDraftSaved && (
                    <button
                      type="button"
                      className="album-model-option album-add-model"
                      onClick={() => setAddingModel(true)}
                    >
                      <span className="album-model-avatar">
                        <Plus />
                      </span>
                      <span>添加新模特</span>
                    </button>
                  )}
                </PagedItems>
              </div>
            </section>
          </div>
        </fieldset>
      </Modal>
      {addingModel && (
        <ModelEditor
          onClose={() => setAddingModel(false)}
          onSaved={(id) =>
            edit({ modelIds: [...new Set([...draft.modelIds, id])] })
          }
        />
      )}
      {discard && (
        <Confirm
          title="放弃未保存的修改？"
          text="当前草稿将被丢弃，已保存的写真集不受影响。"
          onClose={() => setDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}
