import { Confirm } from "@/ui/Confirm";
import { Modal } from "@/ui/Modal";
import { uid } from "@/domain/database";
import { prepareProfileFields } from "@/domain/profile-fields";
import { normalizeSocialLinks } from "@/domain/social-links";
import { type MediaItem, type ModelProfile } from "@/domain/types";
import { selectProfileImage } from "@/infrastructure/profile-image";
import {
  readEntity,
  readModelAlbums,
} from "@/infrastructure/desktop-repository";
import { useData } from "@/state/data-context";
import { Button } from "@/ui/ActionButton";
import { AvatarEditor } from "@/ui/AvatarEditor";
import { BackgroundEditor } from "@/ui/BackgroundEditor";
import { Checkbox } from "@/ui/LabeledCheckbox";
import { PagedItems } from "@/ui/PagedItems";
import { ProfileFieldsEditor } from "@/ui/ProfileFieldsEditor";
import { SocialLinksEditor } from "@/ui/SocialLinksEditor";
import { MotionPanel } from "@/ui/MotionPanel";
import { ModelEditorTabs } from "./ModelEditorTabs";
import {
  Image,
  Library,
  Link as LinkIcon,
  List,
  UserRound,
  Wallpaper,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Field } from "@/ui/Field";
export function ModelEditor(props: {
  model?: ModelProfile;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { page } = useData();
  const [prepared, setPrepared] = useState<{
    model: ModelProfile;
    albumIds: string[];
  }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!page || !props.model) return;
    let alive = true;
    setError("");
    void Promise.all([
      readEntity<ModelProfile>("models", props.model.id),
      readModelAlbums(props.model.id),
    ]).then(
      ([model, albumIds]) => {
        if (!alive) return;
        if (!model) {
          setError("模特资料已不存在，请刷新页面后重试");
          return;
        }
        setPrepared({ model, albumIds });
      },
      (e) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [props.model?.id, !!page, attempt]);
  if (!page || !props.model) return <ModelEditorDraft key={props.model?.id || 'new'} {...props} />;
  if (prepared?.model.id === props.model.id)
    return (
      <ModelEditorDraft
        key={prepared.model.id}
        {...props}
        model={prepared.model}
        initialAlbumIds={prepared.albumIds}
      />
    );
  return (
    <Modal
      title="编辑资料"
      wide
      className="model-editor-modal"
      onClose={props.onClose}
    >
      <p role={error ? "alert" : "status"}>{error || "正在读取资料…"}</p>
      {error && <Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>}
    </Modal>
  );
}
function ModelEditorDraft({
  model,
  onClose,
  onSaved,
  initialAlbumIds,
}: {
  model?: ModelProfile;
  onClose: () => void;
  onSaved?: (id: string) => void;
  initialAlbumIds?: string[];
}) {
  const { db, act } = useData();
  const [initial] = useState<ModelProfile>(() =>
    structuredClone(
      model || {
        id: uid(),
        name: "",
        alias: "",
        bio: "",
        avatar: "",
        background: "",
        avatarFocus: 35,
        backgroundFocus: 35,
        fields: [],
        links: [],
        photoIds: [],
      },
    ),
  );
  const [fieldInitial] = useState(() =>
    prepareProfileFields(initial.fields, uid),
  );
  const [draft, set] = useState(() => ({ ...initial, fields: fieldInitial })),
    [initialAlbums] = useState(
      () =>
        initialAlbumIds ||
        db.albums
          .filter((a) => a.modelIds.includes(initial.id))
          .map((a) => a.id),
    ),
    [albums, setAlbums] = useState(initialAlbums),
    [tab, setTab] = useState(0),
    [discard, setDiscard] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const edit = (p: Partial<ModelProfile>) => set((d) => ({ ...d, ...p }));
  const [customAvatar, setCustomAvatar] = useState<MediaItem>();
  const [customBackground, setCustomBackground] = useState<MediaItem>();
  const [selectingImage, setSelectingImage] = useState(false);
  const selectingImageRef = useRef(false);
  const chooseImageFile = async (purpose: "avatar" | "background") => {
    if (selectingImageRef.current || savingRef.current) return;
    selectingImageRef.current = true;
    setSelectingImage(true);
    setError("");
    try {
      const image = await selectProfileImage(purpose);
      if (image && purpose === "avatar") {
        setCustomAvatar(image);
        edit({
          avatar: image.src,
          avatarFocus: 50,
          avatarCrop: { x: 50, y: 50, zoom: 1 },
        });
      } else if (image) {
        setCustomBackground(image);
        edit({
          background: image.src,
          backgroundFocus: 50,
          backgroundCrop: { x: 50, y: 50, zoom: 1 },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      selectingImageRef.current = false;
      setSelectingImage(false);
    }
  };
  const close = () => {
    if (savingRef.current || selectingImageRef.current) return;
    if (
      JSON.stringify(draft) !==
        JSON.stringify({ ...initial, fields: fieldInitial }) ||
      JSON.stringify(albums) !== JSON.stringify(initialAlbums)
    )
      setDiscard(true);
    else onClose();
  };
  const tabIcons = [UserRound, Image, Wallpaper, List, LinkIcon, Library];
  const tabs = [
    "基本资料",
    "模特头像",
    "背景图片",
    "详细资料",
    "社交链接",
    "关联写真集",
  ];
  const save = async () => {
    if (savingRef.current || selectingImageRef.current) return;
    if (!draft.name.trim()) {
      setError("请输入模特名称");
      setTab(0);
      return;
    }
    let links: ModelProfile["links"];
    if (
      draft.fields.some((field) => field.value.trim() && !field.label.trim())
    ) {
      setError("请填写自定义资料的名称");
      setTab(3);
      return;
    }
    try {
      links = normalizeSocialLinks(draft.links);
    } catch (error) {
      setError(error instanceof Error ? error.message : "请检查社交链接");
      setTab(4);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const originalIds = new Set(initial.fields.map((field) => field.id));
      const fields = draft.fields.filter(
        (field) => field.value.trim() || originalIds.has(field.id),
      );
      await act({
        type: "saveModel",
        model: { ...draft, fields, links },
        albumIds: albums,
        avatarImage:
          customAvatar?.src === draft.avatar ? customAvatar : undefined,
        backgroundImage:
          customBackground?.src === draft.background
            ? customBackground
            : undefined,
      });
      onClose();
      onSaved?.(draft.id);
    } catch {
      setError("保存失败，草稿已保留，请重试");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <Modal
        title={model ? "编辑资料" : "添加模特"}
        className={`model-editor-modal ${
          tab === 1
            ? "avatar-editor-modal"
            : tab === 2
              ? "background-editor-modal"
              : ""
        }`}
        wide
        onClose={close}
        footer={
          <>
            <span className="error" role="alert">
              {error}
            </span>
            <Button disabled={saving || selectingImage} onClick={close}>
              取消
            </Button>
            <Button
              variant="default"
              disabled={saving || selectingImage}
              onClick={() => void save()}
            >
              {saving ? "正在保存…" : "保存"}
            </Button>
          </>
        }
      >
        <fieldset
          disabled={saving || selectingImage}
          style={{ minWidth: 0 }}
          className={`profile-editor ${tab === 1 ? "profile-editor-avatar" : tab === 2 ? "profile-editor-background" : ""}`}
        >
          <ModelEditorTabs
            tabs={tabs}
            icons={tabIcons}
            active={tab}
            onChange={setTab}
          />
          <MotionPanel
            index={tab}
            animateHeight
            immediateExit={tab === 1 || tab === 2}
            className="editor-content motion-panel"
          >
            {tab !== 1 && tab !== 2 && <h3>{tabs[tab]}</h3>}
            {tab === 0 && (
              <>
                <Field
                  label="模特名称"
                  value={draft.name}
                  onChange={(name) => edit({ name })}
                />
                <Field
                  label="别名"
                  value={draft.alias}
                  onChange={(alias) => edit({ alias })}
                />
                <Field
                  label="简介"
                  multi
                  value={draft.bio}
                  onChange={(bio) => edit({ bio })}
                />
              </>
            )}
            {tab === 1 && (
              <AvatarEditor
                model={draft}
                albumIds={albums}
                custom={customAvatar}
                onChange={edit}
                disabled={saving || selectingImage}
                onSelectFile={() => void chooseImageFile("avatar")}
              />
            )}
            {tab === 2 && (
              <BackgroundEditor
                model={draft}
                albumIds={albums}
                custom={customBackground}
                onChange={edit}
                avatarSourcePath={
                  customAvatar?.src === draft.avatar
                    ? customAvatar.sourcePath
                    : undefined
                }
                disabled={saving || selectingImage}
                onSelectFile={() => void chooseImageFile("background")}
              />
            )}
            {tab === 3 && (
              <ProfileFieldsEditor
                fields={draft.fields}
                onChange={(fields) => edit({ fields })}
              />
            )}
            {tab === 4 && (
              <SocialLinksEditor
                links={draft.links}
                onChange={(links) => edit({ links })}
              />
            )}
            {tab === 5 && (
              <PagedItems
                kind="albums"
                className="album-choices"
                label="关联写真集"
                items={db.albums}
                render={(a) => (
                  <Checkbox
                    key={a.id}
                    label={a.name}
                    checked={albums.includes(a.id)}
                    onCheckedChange={(checked) =>
                      setAlbums(
                        checked === true
                          ? [...albums, a.id]
                          : albums.filter((id) => id !== a.id),
                      )
                    }
                  />
                )}
              />
            )}
          </MotionPanel>
        </fieldset>
      </Modal>
      {discard && (
        <Confirm
          title="放弃未保存的修改？"
          text="所有分区的草稿会一起丢弃。"
          onClose={() => setDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}
