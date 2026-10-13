import { NativeSelect,NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { recommendationSettings } from "@/domain/recommendation-settings";
import { type Database } from '@/domain/types';
import { useData } from '@/state/data-context';
import { useState } from 'react';

export function RecommendationSettings() {
  const { db, mutate, notice } = useData();
  const preferences = recommendationSettings(db.settings);
  const [saving, setSaving] = useState(false);
  async function save<K extends keyof Database['settings']>(key: K, value: Database['settings'][K]) {
    setSaving(true);
    try { await mutate(draft => { draft.settings[key] = value; }); }
    catch { notice('推荐轮换设置保存失败，请重试'); }
    finally { setSaving(false); }
  }
  return <section className="settings-group" aria-labelledby="settings-recommendations-title">
    <h3 className="settings-group-title" id="settings-recommendations-title">推荐轮换</h3>
    <div className="settings-control-row">
      <div><label htmlFor="settings-recommendation-auto">自动轮换</label></div>
      <Switch id="settings-recommendation-auto" aria-label="自动轮换推荐" checked={preferences.automatic}
        disabled={saving} onCheckedChange={value => void save('recommendationAutoRotate', value)} />
    </div>
    <div className="settings-control-row">
      <div><label htmlFor="settings-recommendation-interval">切换间隔</label></div>
      <NativeSelect id="settings-recommendation-interval" aria-label="推荐切换间隔" value={preferences.intervalSeconds}
        disabled={saving} onChange={event => void save('recommendationIntervalSeconds', Number(event.target.value) as Database['settings']['recommendationIntervalSeconds'])}>
        {[3, 6, 10, 15, 30, 60].map(seconds => <NativeSelectOption key={seconds} value={seconds}>{seconds} 秒</NativeSelectOption>)}
      </NativeSelect>
    </div>
    <div className="settings-control-row">
      <div><label htmlFor="settings-recommendation-transition">过渡速度</label></div>
      <NativeSelect id="settings-recommendation-transition" aria-label="推荐过渡速度" value={preferences.transitionMs}
        disabled={saving} onChange={event => void save('recommendationTransitionMs', Number(event.target.value) as Database['settings']['recommendationTransitionMs'])}>
        <NativeSelectOption value={400}>快速 · 0.4 秒</NativeSelectOption>
        <NativeSelectOption value={800}>柔和 · 0.8 秒</NativeSelectOption>
        <NativeSelectOption value={1200}>舒缓 · 1.2 秒</NativeSelectOption>
      </NativeSelect>
    </div>
    <div className="settings-control-row">
      <div><label htmlFor="settings-recommendation-hover">悬停时暂停</label></div>
      <Switch id="settings-recommendation-hover" aria-label="推荐悬停时暂停" checked={preferences.pauseOnHover}
        disabled={saving} onCheckedChange={value => void save('recommendationPauseOnHover', value)} />
    </div>
  </section>;
}
