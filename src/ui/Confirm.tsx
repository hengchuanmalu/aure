import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/ui/ActionButton";
import { useRef, useState } from "react";
export function Confirm({
  title,
  text,
  onConfirm,
  onClose,
  confirmLabel = "确认",
}: {
  title: string;
  text: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  confirmLabel?: string;
}) {
  const previous = useRef(document.activeElement as HTMLElement | null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try { await onConfirm(); onClose(); }
    catch { setError('操作失败，请重试'); }
    finally { pending.current = false; setBusy(false); }
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <AlertDialogContent
        className="confirmation-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus();
        }}
      >
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{text}</AlertDialogDescription>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <AlertDialogCancel asChild>
            <Button disabled={busy}>继续编辑</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="default" disabled={busy} onClick={event => { event.preventDefault(); void confirm(); }}>
              {busy ? '正在处理…' : confirmLabel}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
