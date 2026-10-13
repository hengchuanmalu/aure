import type { Album,Database,MediaItem,ModelProfile } from '../../src/domain/types';
import metadata from "../fixtures/media-manifest.json" with { type: "json" };
export const photoIds = [
  1239291, 774909, 733872, 1382731, 1858175, 1462637, 762020, 1181686, 1036623,
  1542085, 1553783, 1536619,
];
export const photos = photoIds.map((id) => `/tests/fixtures/media/p-${id}.jpg`);
export const seedFixture = (): Database => {
  const groups = ["风格", "场景", "季节", "情绪", "服装"].map((name, i) => ({
    id: `g${i}`,
    name,
  }));
  const names = [
    ["清新", "复古", "胶片", "日系"],
    ["城市", "森林", "花园", "海边"],
    ["春", "夏", "秋", "冬"],
    ["温柔", "清冷", "治愈"],
    ["连衣裙", "毛衣", "休闲"],
  ];
  const tags = names.flatMap((ns, i) =>
    ns.map((name, j) => ({ id: `t${i}${j}`, name, groupId: `g${i}` })),
  );
  const media: MediaItem[] = photos.map((src, i) => ({
    id: `p${i}`,
    kind: "image",
    src,
    name: `Synthetic-${photoIds[i]}.jpg`,
    width: 1600,
    height: i === 0 ? 1067 : 2400,
    size: 0,
    tags: [`t0${i % 4}`, `t1${i % 4}`],
    favorite: i === 1,
    liked: false,
    rating: 0,
  }));
  media.push(
    ...["flower", "flower-portrait"].map((n, i): MediaItem => ({
      id: `v${i}`,
      kind: "video",
      src: `/tests/fixtures/media/${n}.mp4`,
      poster: `/tests/fixtures/media/${n}.jpg`,
      name: `${n}.mp4`,
      width: i ? 304 : 960,
      height: 540,
      size: 0,
      duration: 5.05,
      tags: ["t12", "t20"],
      favorite: false,
      liked: false,
      rating: 0,
    })),
  );
  const albumNames = [
    "光落在肩上",
    "城市漫游",
    "把夏天留下",
    "午后的慢时光",
    "绿意之间",
    "一封温柔的信",
    "日常的诗意",
    "风与自由",
    "浅浅的蓝",
    "在光里相遇",
    "漫长的午后",
    "好久不见",
  ];
  const albums = albumNames.map((name, i): Album => ({
    id: `a${i}`,
    name,
    subtitle: [
      "收集光，也收集片刻",
      "让日常成为值得珍藏的风景",
      "关于夏日的一些记忆",
    ][i % 3],
    description:
      "在平凡的日子里，留住光线、色彩与真实的表情。这是一组供你探索aure的演示收藏。",
    cover: photos[i],
    mediaIds: [
      `p${i}`,
      `p${(i + 1) % 12}`,
      `p${(i + 2) % 12}`,
      ...(i === 0 ? ["v0", "v1"] : []),
    ],
    tags: [`t0${i % 4}`, `t1${i % 4}`, `t2${i % 4}`],
    modelIds: [`m${i % 6}`],
    favorite: i === 0 || i === 4,
    createdAt: `2026-09-${String(i + 1).padStart(2, "0")}`,
    updatedAt: `2026-09-${String(26 - i).padStart(2, "0")}`,
  }));
  const models = ["林夏", "许知遥", "陈以宁", "沈青", "苏晴", "江月"].map(
    (name, i): ModelProfile => ({
      id: `m${i}`,
      name,
      alias: `演示档案 ${String(i + 1).padStart(2, "0")}`,
      bio: "用镜头收藏日常的温柔。此为虚构演示档案，素材人物与姓名、资料无对应关系。",
      avatar: photos[i],
      background: photos[i],
      avatarFocus: 35,
      backgroundFocus: 35,
      fields: [
        {
          id: `f${i}`,
          label: "偏好风格",
          value: ["自然光 · 清新", "城市 · 胶片", "复古 · 温柔"][i % 3],
          group: "风格与兴趣",
        },
        {
          id: `n${i}`,
          label: "收藏笔记",
          value: "留住每一次与光的相遇。",
          group: "个人备注",
        },
      ],
      links: [],
      photoIds: [`p${i}`],
    }),
  );
  media.forEach((m) =>
    Object.assign(
      m,
      (
        metadata as Record<
          string,
          { width: number; height: number; size: number }
        >
      )[m.src],
    ),
  );
  return {
    version: 1,
    albums,
    media,
    models,
    tags,
    groups,
    recent: [{ albumId: "a2", at: "2026-09-26T08:00:00.000Z" }],
    settings: { reducedMotion: false },
  };
};
