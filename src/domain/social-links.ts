export type SocialLink = { label: string; url: string };

const platforms = [
  { id: "x", name: "Twitter", domains: ["x.com", "twitter.com"] },
  { id: "instagram", name: "Instagram", domains: ["instagram.com"] },
  { id: "bilibili", name: "哔哩哔哩", domains: ["bilibili.com", "b23.tv"] },
  { id: "sinaweibo", name: "微博", domains: ["weibo.com", "weibo.cn"] },
  { id: "tiktok", name: "抖音", domains: ["douyin.com", "iesdouyin.com"] },
  {
    id: "xiaohongshu",
    name: "小红书",
    domains: ["xiaohongshu.com", "xhslink.com"],
  },
  { id: "kuaishou", name: "快手", domains: ["kuaishou.com", "gifshow.com"] },
  { id: "youtube", name: "YouTube", domains: ["youtube.com", "youtu.be"] },
  { id: "tiktok", name: "TikTok", domains: ["tiktok.com"] },
  {
    id: "facebook",
    name: "Facebook",
    domains: ["facebook.com", "fb.com", "fb.me"],
  },
  { id: "telegram", name: "Telegram", domains: ["t.me", "telegram.me"] },
  { id: "threads", name: "Threads", domains: ["threads.net", "threads.com"] },
  { id: "bluesky", name: "Bluesky", domains: ["bsky.app"] },
  { id: "pixiv", name: "pixiv", domains: ["pixiv.net"] },
  { id: "patreon", name: "Patreon", domains: ["patreon.com"] },
  { id: "twitch", name: "Twitch", domains: ["twitch.tv"] },
  { id: "discord", name: "Discord", domains: ["discord.com", "discord.gg"] },
  { id: "reddit", name: "Reddit", domains: ["reddit.com", "redd.it"] },
] as const;

/** Only website links are accepted; bare domains are normalized for pasting. */
export function websiteUrl(input: string): string | undefined {
  const value = input.trim();
  if (!value || /\s/.test(value)) return;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".")
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

export function socialPlatform(input: string) {
  const normalized = websiteUrl(input);
  if (!normalized) return;
  const host = new URL(normalized).hostname.toLowerCase();
  return platforms.find((platform) =>
    platform.domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ),
  );
}

export function socialLinkName(link: SocialLink) {
  return link.label.trim() || socialPlatform(link.url)?.name || "官方网址";
}

/** Update inferred labels, while preserving an explicitly customized label. */
export function editSocialLinkUrl(link: SocialLink, url: string): SocialLink {
  const inferredBefore = socialPlatform(link.url)?.name || "官方网址";
  const automatic = !link.label.trim() || link.label === inferredBefore;
  const inferredAfter = websiteUrl(url)
    ? socialPlatform(url)?.name || "官方网址"
    : "";
  return { url, label: automatic ? inferredAfter : link.label };
}

export function normalizeSocialLinks(links: SocialLink[]): SocialLink[] {
  return links
    .filter((link) => link.url.trim())
    .map((link) => {
      const url = websiteUrl(link.url);
      if (!url) throw new Error("请填写有效的 http:// 或 https:// 网址");
      return { url, label: socialLinkName({ ...link, url }) };
    });
}
