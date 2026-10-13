import { Confirm } from "@/ui/Confirm";
import { Modal } from "@/ui/Modal";
import {
  prepareRestore,
  type RestorePreview,
} from "@/infrastructure/catalog-maintenance";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { buildInfo } from "@/infrastructure/build-info";
import { useData } from "@/state/data-context";
import { useMaintenancePreview } from '@/state/useMaintenancePreview';
import { Button } from "@/ui/ActionButton";
import { RecommendationSettings } from "@/ui/RecommendationSettings";
import { MotionPanel } from "@/ui/MotionPanel";
import { MotionSelection } from "@/ui/MotionSelection";
import {
  Database,
  Download,
  Info,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";

type SettingsCategory = "advanced" | "library" | "about";

export default function Settings() {
  const { db, page, mutate, reset, notice, exportBackup, restoreBackup } =
    useData();
  const { preview: restorePreview, prepare: prepareRestorePreview, cancel: cancelRestorePreview, commit: commitRestorePreview } = useMaintenancePreview<RestorePreview>();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [syncSaving, setSyncSaving] = useState(false);
  const closeRestore = () => {
    if (restoring) return;
    cancelRestorePreview();
    setRestoreError("");
  };
  const [category, setCategory] = useState<SettingsCategory>("library");
  const [confirm, setConfirm] = useState(false);
  const [savingMotion, setSavingMotion] = useState(false);
  const [savingVideoCover, setSavingVideoCover] = useState(false);
  const [exporting, setExporting] = useState(false);
  const libraryName = page ? "本地图库" : "预览库";
  const categories = [
    { id: "library" as const, name: libraryName, icon: Database },
    { id: "advanced" as const, name: "高级设置", icon: SlidersHorizontal },
    { id: "about" as const, name: "关于", icon: Info },
  ];

  const backup = async () => {
    setExporting(true);
    try {
      if (exportBackup) {
        if (await exportBackup()) notice("图库备份已导出");
      } else {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "aure-preview-backup.json";
        link.click();
        URL.revokeObjectURL(url);
        notice("预览元数据已导出");
      }
    } catch (error) {
      notice(`备份失败：${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-pad settings-page">
      <div className="page-heading">
        <h1>设置</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          <MotionSelection value={category}>
            {categories.map(({ id, name, icon: Icon }) => (
              <Button
                key={id}
                data-id={id}
                variant="ghost"
                className="settings-nav-item"
                aria-current={category === id ? "page" : undefined}
                aria-controls="settings-content"
                onClick={() => setCategory(id)}
                icon={<Icon aria-hidden="true" />}
              >
                {name}
              </Button>
            ))}
          </MotionSelection>
        </nav>
        <section
          className="settings-content"
          id="settings-content"
          aria-labelledby={`settings-category-${category}`}
        >
          <MotionPanel
            index={categories.findIndex((item) => item.id === category)}
            className="motion-panel"
          >
            <header className="settings-content-heading">
              <h2 id={`settings-category-${category}`}>
                {categories.find((item) => item.id === category)?.name}
              </h2>
            </header>
            {category === "advanced" && (
              <>
                <RecommendationSettings />
                <section
                  className="settings-group"
                  aria-labelledby="settings-motion-title"
                >
                  <h3
                    className="settings-group-title"
                    id="settings-motion-title"
                  >
                    界面动效
                  </h3>
                  <div className="settings-control-row">
                    <div>
                      <label htmlFor="settings-motion">减少动态效果</label>
                    </div>
                    <Switch
                      id="settings-motion"
                      aria-label="减少动态效果"
                      checked={db.settings.reducedMotion}
                      disabled={savingMotion}
                      onCheckedChange={async (checked) => {
                        setSavingMotion(true);
                        try {
                          await mutate((draft) => {
                            draft.settings.reducedMotion = checked;
                          });
                        } catch {
                          notice("动态效果设置保存失败，请重试");
                        } finally {
                          setSavingMotion(false);
                        }
                      }}
                    />
                  </div>
                </section>
                <section
                  className="settings-group"
                  aria-labelledby="settings-video-title"
                >
                  <h3
                    className="settings-group-title"
                    id="settings-video-title"
                  >
                    视频
                  </h3>
                  <div className="settings-control-row">
                    <div>
                      <label htmlFor="settings-video-cover">视频封面</label>
                    </div>
                    <NativeSelect
                      id="settings-video-cover"
                      aria-label="视频封面取帧位置"
                      value={db.settings.videoPosterPercent ?? 10}
                      disabled={savingVideoCover}
                      onChange={async (event) => {
                        const percent = Number(event.target.value) as
                          10 | 50 | 90;
                        setSavingVideoCover(true);
                        try {
                          await mutate((draft) => {
                            draft.settings.videoPosterPercent = percent;
                          });
                        } catch {
                          notice("视频封面设置保存失败，请重试");
                        } finally {
                          setSavingVideoCover(false);
                        }
                      }}
                    >
                      <NativeSelectOption value={10}>前段</NativeSelectOption>
                      <NativeSelectOption value={50}>中段</NativeSelectOption>
                      <NativeSelectOption value={90}>后段</NativeSelectOption>
                    </NativeSelect>
                  </div>
                </section>
              </>
            )}
            {category === "library" && (
              <>
                <section
                  className="settings-group"
                  aria-labelledby="settings-data-title"
                >
                  <h3 className="settings-group-title" id="settings-data-title">
                    图库资料
                  </h3>
                  {page ? (
                    <>
                      <div className="settings-library-summary">
                        <div>
                          <strong>{page.albumTotal.toLocaleString()}</strong>
                          <span>套写真</span>
                        </div>
                        <div>
                          <strong>{page.mediaCount.toLocaleString()}</strong>
                          <span>项媒体</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="settings-note">
                      浏览器使用独立预览库；真实文件夹导入请在桌面版使用。
                    </p>
                  )}
                  <div className="settings-control-row">
                    <div>
                      <span className="settings-row-label">
                        {page ? "图库备份" : "预览数据"}
                      </span>
                      <p>导出图库资料，不包含原始媒体</p>
                    </div>
                    <Button
                      icon={<Download />}
                      disabled={exporting}
                      onClick={() => void backup()}
                    >
                      {exporting ? "正在导出…" : page ? "导出备份" : "导出数据"}
                    </Button>
                  </div>
                  {restoreBackup && (
                    <>
                      <div className="settings-control-row">
                        <div>
                          <span className="settings-row-label">恢复图库</span>
                          <p>恢复前会自动备份当前图库，原始媒体保持不变</p>
                        </div>
                        <Button
                          disabled={restoring}
                          onClick={async () => {
                            setRestoring(true);
                            setRestoreError("");
                            try {
                              await prepareRestorePreview(prepareRestore);
                            } catch (reason) {
                              notice(`备份读取失败：${String(reason)}`);
                            } finally {
                              setRestoring(false);
                            }
                          }}
                        >
                          选择备份
                        </Button>
                      </div>
                      <div className="settings-control-row">
                        <div>
                          <label htmlFor="settings-folder-sync">
                            同步已导入文件夹
                          </label>
                          <p>定期读取新增媒体和文件变化；缺失项保留记录</p>
                        </div>
                        <Switch
                          id="settings-folder-sync"
                          checked={db.settings.syncImportedFolders ?? false}
                          disabled={syncSaving}
                          onCheckedChange={async (enabled) => {
                            setSyncSaving(true);
                            try {
                              await mutate((d) => {
                                d.settings.syncImportedFolders = enabled;
                              });
                            } catch {
                              notice("文件夹同步设置保存失败");
                            } finally {
                              setSyncSaving(false);
                            }
                          }}
                        />
                      </div>
                    </>
                  )}
                </section>
                <section
                  className="settings-group settings-reset-group"
                  aria-labelledby="settings-reset-title"
                >
                  <h3
                    className="settings-group-title"
                    id="settings-reset-title"
                  >
                    重置
                  </h3>
                  <div className="settings-control-row">
                    <div>
                      <span className="settings-row-label">
                        重置{libraryName}
                      </span>
                    </div>
                    <Button
                      className="settings-reset-button"
                      icon={<RotateCcw />}
                      onClick={() => setConfirm(true)}
                    >
                      重置{libraryName}
                    </Button>
                  </div>
                </section>
              </>
            )}
            {category === "about" && (
              <section className="settings-group" aria-label="应用信息">
                <div className="settings-brand">
                  <img src="/brand.png" alt="" />
                  <div>
                    <strong>aure</strong>
                  </div>
                </div>
                <div className="settings-control-row">
                  <span className="settings-row-label">当前版本号</span>
                  <span className="settings-readonly">{buildInfo.version}</span>
                </div>
                <div className="settings-control-row">
                  <span className="settings-row-label">版本时间</span>
                  <span className="settings-readonly">{buildInfo.date}</span>
                </div>
                <div className="settings-control-row">
                  <span className="settings-row-label">GitHub</span>
                  <span className="settings-readonly">即将上线</span>
                </div>
              </section>
            )}
          </MotionPanel>
        </section>
      </div>
      {confirm && (
        <Confirm
          title={`重置${libraryName}？`}
          text={`将清除写真记录、模特、匹配规则、编辑、收藏、标签和历史，恢复为空图库。磁盘原件不受影响。${page ? "重置前会自动保存图库备份；你也可以先导出一份备份。" : "请先导出备份。"}`}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await reset();
            setConfirm(false);
            notice(page ? "图库已重置，重置前备份已保留" : "预览库已重置");
          }}
        />
      )}
      {restorePreview && (
        <Modal
          title="恢复图库备份？"
          onClose={closeRestore}
          footer={
            <>
              <span className="error" role="alert">
                {restoreError}
              </span>
              <Button disabled={restoring} onClick={closeRestore}>
                取消
              </Button>
              <Button
                variant="default"
                disabled={restoring}
                onClick={async () => {
                  setRestoring(true);
                  setRestoreError("");
                  try {
                    await commitRestorePreview(token => restoreBackup!(token));
                    notice("图库已恢复，恢复前备份已保留");
                  } catch (reason) {
                    setRestoreError(String(reason));
                  } finally {
                    setRestoring(false);
                  }
                }}
              >
                {restoring ? "正在恢复…" : "恢复备份"}
              </Button>
            </>
          }
        >
          <p>{restorePreview.name}</p>
          <p>
            {restorePreview.albums} 套写真 · {restorePreview.models} 位模特 ·{" "}
            {restorePreview.media} 项媒体
          </p>
          <p>
            确认后以备份替换当前图库资料，不合并记录。当前图库会先自动备份；原始媒体文件不会修改。
          </p>
        </Modal>
      )}
    </div>
  );
}
