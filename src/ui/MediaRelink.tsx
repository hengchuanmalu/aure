import { useData } from "@/state/data-context";
import {
  prepareMediaRelink,
  type MediaRelinkPreview,
} from "@/infrastructure/catalog-maintenance";
import { Button } from "@/ui/ActionButton";
import { Modal } from "@/ui/Modal";
import { useState } from "react";
import { useMaintenancePreview } from '@/state/useMaintenancePreview';
export function MediaRelink({ id }: { id: string }) {
  const { relinkMedia } = useData();
  const { preview, prepare: preparePreview, cancel: cancelPreview, commit: commitPreview } = useMaintenancePreview<MediaRelinkPreview>(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (busy) return;
    cancelPreview();
  };
  if (!relinkMedia) return null;
  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await preparePreview(() => prepareMediaRelink(id));
          } catch (reason) {
            setError(String(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        重新关联文件
      </Button>
      {!preview && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <Modal
          title="重新关联媒体文件？"
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
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await commitPreview(token => relinkMedia(token));
                  } catch (reason) {
                    setError(String(reason));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在关联…" : "确认关联"}
              </Button>
            </>
          }
        >
          <p>
            {preview.previousName} → {preview.name}
          </p>
          <p className="maintenance-path">{preview.path}</p>
          <p>
            保留收藏、标签和评分，并更新所有引用这项媒体的写真。原始文件不会修改；当前图库会先自动备份。
          </p>
        </Modal>
      )}
    </>
  );
}
