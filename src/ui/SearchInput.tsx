import { Input as PrimitiveInput } from "@/components/ui/input";
import type { ComponentProps,ReactNode } from "react";

export function Input({
  contentBefore,
  contentAfter,
  ...props
}: ComponentProps<typeof PrimitiveInput> & {
  contentBefore?: ReactNode;
  contentAfter?: ReactNode;
}) {
  if (!contentBefore && !contentAfter) return <PrimitiveInput {...props} />;
  return (
    <span className="search-input">
      {contentBefore}
      <PrimitiveInput {...props} />
      {contentAfter}
    </span>
  );
}
