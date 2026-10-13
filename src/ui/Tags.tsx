import { catalog } from "@/domain/catalog";
import { useData } from "@/state/data-context";
import { TagLabel } from "@/ui/TagLabel";
import { Link } from "react-router-dom";
export function Tags({
  ids,
  interactive = true,
}: {
  ids: string[];
  interactive?: boolean;
}) {
  const { db } = useData();
  return (
    <div className="chips">
      {ids.map((id) => {
        const t = catalog(db).tags.get(id);
        return (
          t &&
          (interactive ? (
            <Link className="chip" key={id} to={`/library?tag=${id}`}>
              <TagLabel>{t.name}</TagLabel>
            </Link>
          ) : (
            <span className="chip" key={id}>
              <TagLabel>{t.name}</TagLabel>
            </span>
          ))
        );
      })}
    </div>
  );
}
