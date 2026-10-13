import { useData } from "@/state/data-context";
import {
  prepareFolderRefresh,
  type FolderPreview,
} from "@/infrastructure/catalog-maintenance";
import { Button } from "@/ui/ActionButton";
import { Modal } from "@/ui/Modal";
import { useState } from "react";
import { useMaintenancePreview } from '@/state/useMaintenancePreview';

export function FolderMaintenance({ albumId }: { albumId: string }) {
  const { refreshFolder } = useData();
  const { preview, prepare: preparePreview, cancel: cancelPreview, commit: commitPreview } = useMaintenancePreview<FolderPreview>(albumId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const prepare = async (relocate: boolean) => {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const result = await preparePreview(() => prepareFolderRefresh(albumId, relocate));
      if (!result) setOpen(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    cancelPreview();
    setOpen(false);
    setError("");
  };
  if (!refreshFolder) return null;
  return (
    <>
      <Button disabled={busy} onClick={() => void prepare(false)}>
        重新扫描
      </Button>
      <Button disabled={busy} onClick={() => void prepare(true)}>
        重新定位文件夹
      </Button>
      {open && (
        <Modal
          title="核对文件夹更新"
          onClose={close}
          footer={
            <>
              <span className="error" role="alert">
                {error}
              </span>
              <Button disabled={busy} onClick={close}>
                取消
              </Button>
              <Button
                variant="default"
                disabled={busy || !preview}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await commitPreview(token => refreshFolder(token));
                    setOpen(false);
                  } catch (reason) {
                    setError(String(reason));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在读取…" : "确认更新"}
              </Button>
            </>
          }
        >
          {preview ? (
            <>
              <h3>{preview.name}</h3>
              <p className="maintenance-path">{preview.directory}</p>
              <p>
                新增 {preview.added} 项 · 重新定位 {preview.moved} 项 · 文件变化{" "}
                {preview.changed} 项 · 缺失 {preview.missing} 项
              </p>
              <p>
                保留收藏、标签及媒体引用。缺失项保留记录；定位按文件名、类型和大小匹配。单个文件已改名时，可在媒体信息中重新关联。
              </p>
            </>
          ) : (
            <p role="status">
              {busy
                ? "正在扫描当前层媒体…"
                : "扫描未完成，可取消后重新选择文件夹。"}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
