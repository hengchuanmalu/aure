import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tests/fixtures');
const mediaRoot = path.join(fixtureRoot, 'media');
const manifestPath = path.join(fixtureRoot, 'media-manifest.json');
const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'));
const ffmpeg = process.env.AURE_FFMPEG || 'ffmpeg';
const version = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8', windowsHide: true });
if (version.error || version.status !== 0) throw new Error('生成合成素材需要 PATH 中的 FFmpeg，或 AURE_FFMPEG 指定的程序。');
mkdirSync(mediaRoot, { recursive: true });

function encode(args, input) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    input, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
}

// Procedural geometric pixels; no photographs, reference images or network access.
function pixels(width, height, seed) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const circle = (u - 0.34) ** 2 + (v - 0.42) ** 2 < 0.035;
    const stripe = Math.floor(u * 12 + v * 5 + seed) % 4 === 0;
    const at = (y * width + x) * 3;
    bytes[at] = circle ? 245 : (45 + seed * 17 + u * 110) % 240;
    bytes[at + 1] = circle ? 180 : stripe ? 210 : 55 + v * 150;
    bytes[at + 2] = circle ? 80 : 120 + u * 90;
  }
  return bytes;
}

const files = [];
let seed = 0;
for (const [url, entry] of Object.entries(metadata)) {
  const name = path.basename(url);
  if (!/^(p-\d+\.jpg|flower(?:-portrait)?\.(?:jpg|mp4))$/.test(name)) throw new Error(`Unexpected fixture: ${name}`);
  const target = path.join(mediaRoot, name);
  const { width, height } = entry;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Invalid fixture dimensions');
  if (name.endsWith('.mp4')) {
    encode(['-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30:duration=5.05`,
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
  } else {
    encode(['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', 'pipe:0',
      '-frames:v', '1', '-q:v', '2', '-update', '1', target], pixels(width, height, seed++));
  }
  const data = readFileSync(target);
  entry.size = data.length;
  files.push({ file: `media/${name}`, width, height, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
writeFileSync(manifestPath, JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(path.join(fixtureRoot, 'provenance.json'), JSON.stringify({ generator: 'scripts/generate-fixtures.mjs', version: 1, license: 'MIT', files }, null, 2) + '\n');
writeFileSync(path.join(fixtureRoot, 'README.md'), '# 合成测试素材\n\n本目录的 JPEG 是程序生成的渐变、条纹与圆形；MP4 是 FFmpeg testsrc2 生成的几何测试视频。没有人物照片、真实图库或外部媒体输入，随项目采用 MIT。\n\n历史文件名仅用于保留现有测试引用。宽高与顺序保持稳定，大小和 SHA-256 见 media-manifest.json 与 provenance.json。\n\n重新生成：在 PATH 配置 FFmpeg 后执行 `npm run fixtures:generate`。普通测试使用已经提交的素材，不需要 FFmpeg。素材只在开发服务器用于测试，不随应用打包。\n');
console.log(`Generated ${files.length} synthetic fixtures.`);
