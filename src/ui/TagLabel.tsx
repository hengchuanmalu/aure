import { Tag } from 'lucide-react';

export function TagLabel({ children }: { children: string }) {
  return <span className="tag-label"><Tag className="tag-label-icon" aria-hidden="true" /><span className="tag-label-text">{children}</span></span>;
}
