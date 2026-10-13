import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/ui/ActionButton";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const previous = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`modal ${wide ? "wide" : ""} ${className}`}
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus();
        }}
      >
        <div className="dialog-layout">
          <header className="dialog-title">
            <DialogTitle>{title}</DialogTitle>
            <Button
              variant="ghost"
              aria-label="关闭"
              icon={<X />}
              onClick={onClose}
            />
          </header>
          <div className="dialog-content">{children}</div>
          {footer && <footer className="dialog-actions">{footer}</footer>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
