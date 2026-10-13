import { describe,expect,it } from 'vitest';
import { editSocialLinkUrl,normalizeSocialLinks,socialLinkName,socialPlatform,websiteUrl } from "../../src/domain/social-links";

describe('social website links', () => {
  it.each([
    ['https://x.com/example', 'Twitter'], ['twitter.com/example', 'Twitter'],
    ['https://www.instagram.com/example/', 'Instagram'], ['https://space.bilibili.com/123', '哔哩哔哩'],
    ['https://b23.tv/abc', '哔哩哔哩'], ['https://weibo.com/u/123', '微博'],
    ['https://m.weibo.cn/u/123', '微博'], ['https://v.douyin.com/abc/', '抖音'],
    ['https://www.tiktok.com/@example', 'TikTok'], ['https://xhslink.com/abc', '小红书'],
    ['https://www.kuaishou.com/profile/123', '快手'], ['https://youtu.be/abc', 'YouTube'],
    ['https://www.facebook.com/example', 'Facebook'], ['https://t.me/example', 'Telegram'],
    ['https://threads.com/@example', 'Threads'], ['https://bsky.app/profile/example', 'Bluesky'],
    ['https://www.pixiv.net/users/123', 'pixiv'], ['https://patreon.com/example', 'Patreon'],
    ['https://twitch.tv/example', 'Twitch'], ['https://discord.gg/abc', 'Discord'],
    ['https://reddit.com/u/example', 'Reddit'],
  ])('recognizes %s', (url, expected) => expect(socialPlatform(url)?.name).toBe(expected));

  it('does not confuse lookalike domains or a platform name inside a path', () => {
    for (const url of ['https://notinstagram.com', 'https://instagram.com.example.org', 'https://example.org/x.com']) {
      expect(socialPlatform(url)).toBeUndefined();
      expect(socialLinkName({ url, label: '' })).toBe('官方网址');
    }
  });
  it('rejects executable schemes, credentials, and invalid pasted text', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/a.jpg', 'data:text/html,hello', 'https://user:pass@x.com', 'not a link', 'https://']) {
      expect(websiteUrl(url)).toBeUndefined();
      expect(() => normalizeSocialLinks([{ url, label: '' }])).toThrow();
    }
  });
  it('updates automatic labels while retaining customized ones', () => {
    expect(editSocialLinkUrl({ url: 'https://x.com/a', label: 'Twitter' }, 'instagram.com/a').label).toBe('Instagram');
    expect(editSocialLinkUrl({ url: 'https://x.com/a', label: '工作账号' }, 'instagram.com/a').label).toBe('工作账号');
    expect(normalizeSocialLinks([{ url: '  instagram.com/a ', label: '' }, { url: '', label: '' }])).toEqual([
      { url: 'https://instagram.com/a', label: 'Instagram' },
    ]);
  });
});
