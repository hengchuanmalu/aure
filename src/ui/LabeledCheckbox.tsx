import { Checkbox as PrimitiveCheckbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useId,type ComponentProps } from "react";

export function Checkbox({
  label,
  id,
  ...props
}: ComponentProps<typeof PrimitiveCheckbox> & { label: string }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div className="checkbox-field">
      <PrimitiveCheckbox {...props} id={controlId} />
      <Label htmlFor={controlId}>{label}</Label>
    </div>
  );
}
