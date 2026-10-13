import { catalog } from "@/domain/catalog";
import { type ModelProfile } from "@/domain/types";
import { useData } from "@/state/data-context";
import { ModelAvatar } from "@/ui/ModelAvatar";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
export function ModelCard({
  model: m,
  avatar,
}: {
  model: ModelProfile;
  avatar?: ReactNode;
}) {
  const { db } = useData();
  const count = m.albumCount ?? catalog(db).modelCounts.get(m.id) ?? 0;
  return (
    <Link className="model-card" to={`/models/${m.id}`}>
      {avatar ?? <ModelAvatar model={m} />}
      <strong>{m.name}</strong>
      <small>{count} 本写真集</small>
    </Link>
  );
}
