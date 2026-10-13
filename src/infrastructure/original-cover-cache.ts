/** At most five homepage originals and 512 MiB of estimated decoded pixels. */
export class OriginalCoverCache {
  private cached = new Map<
    string,
    { image: HTMLImageElement; bytes: number }
  >();
  constructor(
    private create: () => HTMLImageElement = () => new Image(),
    private pixelBudget = 512 * 1024 * 1024,
    private entryBudget = 5,
  ) {}
  take(key: string) {
    const image = this.cached.get(key)?.image || this.create();
    this.cached.delete(key);
    return image;
  }
  release(key: string, image: HTMLImageElement) {
    image.remove();
    const bytes = image.naturalWidth * image.naturalHeight * 4;
    this.cached.delete(key);
    if (!image.complete || bytes <= 0 || bytes > this.pixelBudget) return;
    this.cached.set(key, { image, bytes });
    let used = [...this.cached.values()].reduce(
      (total, entry) => total + entry.bytes,
      0,
    );
    while (used > this.pixelBudget || this.cached.size > this.entryBudget) {
      const oldest = this.cached.keys().next().value!;
      used -= this.cached.get(oldest)!.bytes;
      this.cached.delete(oldest);
    }
  }
}

export const originalCoverCache = new OriginalCoverCache();
