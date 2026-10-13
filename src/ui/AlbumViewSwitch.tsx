import { Button } from "@/ui/ActionButton";
import { Layers, LayoutGrid } from "lucide-react";

export function AlbumViewSwitch({
  value,
  onChange,
}: {
  value: "stack" | "cover";
  onChange: (value: "stack" | "cover") => void;
}) {
  return (
    <div className="view-switch" role="group" aria-label="写真集展示方式">
      <Button
        variant="ghost"
        aria-pressed={value === "stack"}
        aria-label="叠放视图"
        title="叠放视图"
        icon={<Layers />}
        onClick={() => onChange("stack")}
      />
      <Button
        variant="ghost"
        aria-pressed={value === "cover"}
        aria-label="封面视图"
        title="封面视图"
        icon={<LayoutGrid />}
        onClick={() => onChange("cover")}
      />
    </div>
  );
}
