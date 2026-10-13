import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/ui/SearchInput";
import { useId } from "react";
export function Field({
  label,
  value,
  onChange,
  multi = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multi?: boolean;
  placeholder?: string;
}) {
  const inputId = useId();
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {multi ? (
        <Textarea
          placeholder={placeholder}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="resize-y"
        />
      ) : (
        <Input
          placeholder={placeholder}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
