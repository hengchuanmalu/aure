import { socialPlatform } from "@/domain/social-links";
import { Globe } from 'lucide-react';

export function SocialIcon({ url }: { url: string }) {
  const platform = socialPlatform(url);
  return platform
    ? <span className="social-icon" aria-hidden="true" style={{ maskImage: `url(/social-icons/${platform.id}.svg)` }} />
    : <Globe className="social-icon" aria-hidden="true" />;
}
