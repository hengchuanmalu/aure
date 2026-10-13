# aure

Windows 本地优先的写真、图片与视频管理应用。围绕「模特 → 写真集 → 媒体」组织内容，支持多模特关联、标签、收藏、评分和连续浏览。应用原名「镜集」。

当前处于早期开发阶段，已有 React 前端与 Tauri 桌面版；尚未提供自动更新或跨平台发行承诺。桌面元数据保存在 SQLite，浏览器预览使用 localStorage。首次启动为空图库，不附带个人写真或示例人物资料。

## 能力与边界

- 从本地写真、模特或写真总目录导入，逐套扫描和事务保存；有效 `album.json` 优先，无 JSON 时使用本地文本规则，歧义字段留空。
- 引用导入默认不移动、复制、重命名或改写原件。同一目录重复导入跳过，不覆盖手动修改。
- 图片 / 视频查看器、按需缩略图、常见 EXIF 与视频信息、缺失文件重新关联、目录重扫和重新定位。
- SQLite 元数据备份与恢复；备份不包含媒体原件。恢复会替换图库元数据，确认前备份当前图库。
- 可选目录同步默认关闭，仅在前台且无编辑弹窗或查看器时轮询登记目录。

媒体支持取决于文件编码、Windows WebView2 和本机工具。浏览器预览不支持真实目录导入，也不能替代桌面媒体验收。

## 使用环境

当前交付是 Windows x64 本机更新，尚未提供面向其他电脑的安装包。兼容性目标为 Windows 10 22H2 / Windows 11 x64 与当前 Evergreen WebView2 Runtime；干净电脑、离线首装和不同硬件的验证仍待完成，不能由本机运行结果推出发行保证。Windows 7 / 8.1、32 位和 ARM64 不在当前验收范围。

WebView2 Runtime 是运行依赖。Windows 10 仍有少数设备未安装它；本机更新在构建和替换前检查 Microsoft 规定的 Runtime 注册信息，缺失或主版本低于 111 时明确停止，保留原安装。该脚本不安装 Runtime，使用前需自行安装。[Microsoft 分发要求](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。前端使用的 Tailwind CSS 4 以 Chrome 111 及更新版本为基础，此下限仅用于拒绝明显过旧的运行环境，正式兼容目标仍为保持更新的 Evergreen Runtime。[Tailwind 兼容说明](https://tailwindcss.com/docs/compatibility)。

| 能力 | 使用条件与边界 |
| --- | --- |
| 图库管理、常规尺寸 JPEG / PNG / WebP / GIF / BMP 缩略图 | 不依赖 FFmpeg；原件可读，当前用户的数据与缓存目录可写。 |
| 视频原件播放 | 由 WebView2 的实际解码能力决定；缺少 ffprobe 时仍尝试原件，不能保证所有容器和编码。 |
| AVIF、超大 JPEG 缩略图，视频封面与信息，兼容播放副本 | 依赖本机 FFmpeg / ffprobe 及对应解码、编码能力；工具从 PATH 或 WinGet Links 查找，不随应用打包。超大图片与播放副本另有内存、尺寸、时间和磁盘预算。 |

应用按离线使用设计，原件保持引用，不改写或自动下载媒体。移动磁盘盘符或目录改变后可重新定位；元数据备份不包含原件。云占位文件需先下载为本地文件并确认能导入；长路径、网络共享、低分辨率与高缩放屏幕的实际兼容性见 [环境验收矩阵](design/spec/05-acceptance.md)，尚未完成的项不作为支持承诺。

## 开发环境

前端使用 Node.js 22.12+（建议 Node 24，见 `.node-version`）和 npm。Windows 桌面还需 Rust 的 MSVC 工具链、Microsoft C++ Build Tools 的「使用 C++ 的桌面开发」、Windows SDK 与 WebView2。详见 [Tauri 官方环境要求](https://tauri.app/start/prerequisites/)。浏览器测试使用 Microsoft Edge。

在仓库根目录运行：

```powershell
npm ci
npm run dev
```

浏览器地址为 `http://127.0.0.1:1420`。桌面开发另行使用：

```powershell
npm run tauri -- dev
```

桌面开发会读取同一 Windows 用户的 aure 图库。运行需要写入数据的原生测试时，必须使用独立 identifier 与可丢弃数据库，见 [贡献指南](CONTRIBUTING.md)。

## 构建与验证

```powershell
npm run build
npm test
npm run check:open-source
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
```

`build` 包含依赖边界与 TypeScript 检查。浏览器交互测试需先运行 `npm run dev`，再另开终端执行 `npm run test:e2e`；不会自动启动开发服务器。

`--no-bundle` 生成 `src-tauri/target/release/aure.exe`，当前配置不生成安装包。本机安装可执行 `npm run desktop:update`：正常关闭旧程序、备份并更新 `%LOCALAPPDATA%/Programs/aure/aure.exe`、校验哈希、创建快捷方式并重启。请先保存草稿；安装目录 `build.json` 用于核对实际运行版本。该命令只更新本机，不发布 GitHub Release。

为继续读取既有图库，应用保留 `local.jingji.desktop` 标识、旧浏览器存储键和内部媒体协议；不要仅为更名修改这些值。

## 代码与文档

React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui / Radix、Lucide、Motion；桌面采用 Tauri 2、Rust 和 SQLite。版本以锁文件为准。

目录与贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，设计规范见 [产品与页面](design/spec/01-product-and-pages.md)、[视觉与组件](design/spec/02-design-system.md)、[交互](design/spec/03-interactions.md)，图库与性能边界见 [大规模图库规范](design/spec/06-large-library.md)。

测试素材由程序生成，仅用于回归测试，不打包进应用。应用图标原稿在 `resources/aure-artwork.png`，可运行 `npm run tauri -- icon resources/icon.svg` 重新生成平台图标。

## 开源与许可

项目采用 [MIT](LICENSE)，第三方代码和资源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安全问题见 [SECURITY.md](SECURITY.md)。用户导入的媒体权利归各自权利人。

公开前运行 `npm run prepare:open-source`，从当前源码生成不包含本地 Git 历史、私人协作文件、参考工程、备份、图库和历史设计图的独立候选目录。具体检查范围和发布步骤见 [开源准备](docs/open-source.md)。
