import { Images } from "lucide-react";
import { type ReactNode } from "react";
export function Empty({
  title = "还没有内容",
  text,
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <Images aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
