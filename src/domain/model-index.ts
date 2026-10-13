const collator = new Intl.Collator("zh-CN");
// Use the earliest collated syllable in each bucket (e.g. 八 / 夕), otherwise
// equally pronounced characters before a later anchor can fall into the previous letter.
const boundaries = [..."阿八嚓咑妸发旮哈讥咔垃妈拏噢妑七呥仨他屲夕丫帀"];
const initials = [..."ABCDEFGHJKLMNOPQRSTWXYZ"];
export const indexLetters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** Chinese names follow the platform's pinyin collation; other scripts/numbers use #. */
export function modelInitial(name: string) {
  const first = [...name.trim().normalize("NFKD")][0] || "";
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  if (!/^[\u4e00-\u9fff]$/.test(first)) return "#";
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (collator.compare(first, boundaries[i]) >= 0) return initials[i];
  }
  return "A";
}
