import { editSocialLinkUrl,socialPlatform,websiteUrl,type SocialLink } from "@/domain/social-links";
import { Button } from "@/ui/ActionButton";
import { Input } from "@/ui/SearchInput";
import { SocialIcon } from "@/ui/SocialIcon";
import { Plus,X } from 'lucide-react';
import { useId } from 'react';

export function SocialLinksEditor({ links, onChange }: { links: SocialLink[]; onChange: (links: SocialLink[]) => void }) {
  const id = useId();
  const update = (index: number, link: SocialLink) => onChange(links.map((current, i) => i === index ? link : current));
  return <div className="social-links-editor">
    {links.map((link, index) => <div className="social-link-row" key={index}>
      <SocialIcon url={link.url} />
      <div className="field">
        <label htmlFor={`${id}-url-${index}`}>网址</label>
        <Input id={`${id}-url-${index}`} value={link.url} placeholder="粘贴账号或主页链接" spellCheck={false}
          onChange={event => update(index, editSocialLinkUrl(link, event.target.value))}
          onBlur={() => { const url = websiteUrl(link.url); if (url && url !== link.url) update(index, editSocialLinkUrl(link, url)); }} />
      </div>
      <div className="field social-link-name">
        <label htmlFor={`${id}-name-${index}`}>平台名称</label>
        <Input id={`${id}-name-${index}`} value={link.label} placeholder={socialPlatform(link.url)?.name || '自动识别'}
          onChange={event => update(index, { ...link, label: event.target.value })} />
      </div>
      <Button variant="ghost" icon={<X />} aria-label={`移除链接 ${index + 1}`} onClick={() => onChange(links.filter((_, i) => i !== index))} />
    </div>)}
    <Button icon={<Plus />} onClick={() => onChange([...links, { label: '', url: '' }])}>添加社交链接</Button>
  </div>;
}
