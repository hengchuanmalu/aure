export function routeQuery(viewer = false) {
  const background = !viewer && history.state?.usr?.backgroundLocation;
  const route = (
    background
      ? background.pathname + background.search
      : location.hash.replace(/^#/, "") || "/"
  ).split("?");
  const parts = route[0].split("/").filter(Boolean);
  const params = new URLSearchParams(route[1]);
  const from = history.state?.usr?.from as string | undefined;
  const fromParams = new URLSearchParams(from?.split("?")[1]);
  return {
    route:
      (parts[0] === "settings" && parts[1] === "tags") ||
      (parts[0] === "tags" && parts[1] === "manage")
        ? "tags"
        : (
            {
              tags: "library",
              album: "album",
              models: parts.length > 1 ? "model" : "models",
              viewer: "viewer",
            } as Record<string, string>
          )[parts[0]] ||
          parts[0] ||
          "home",
    tagSidebar: parts[0] === "tags" && !parts[1],
    id: parts[0] === "viewer" ? parts[2] : parts[1],
    owner: parts[1],
    q: params.get("q") || "",
    model: params.get("model") || "",
    tags: params.getAll("tag"),
    kind:
      params.get("type") ||
      params.get("kind") ||
      fromParams.get("type") ||
      "all",
    sort: params.get("sort") || "updated",
    order: params.get("order") || "",
    page:
      ["library", "tags", "album", "favorites"].includes(parts[0]) ||
      (parts[0] === "models" && parts[1])
        ? 0
        : Math.max(0, Number(params.get("page")) || 0),
    limit: 96,
  };
}
