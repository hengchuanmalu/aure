# aure

Windows 本地优先的写真、图片与视频管理应用。围绕「模特 → 写真集 → 媒体」整理内容，让浏览、查找和维护个人图库更方便。原名「镜集」。

[![CI](https://github.com/hengchuanmalu/aure/actions/workflows/ci.yml/badge.svg)](https://github.com/hengchuanmalu/aure/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hengchuanmalu/aure?include_prereleases)](https://github.com/hengchuanmalu/aure/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[下载 Windows 版](https://github.com/hengchuanmalu/aure/releases) · [报告问题](https://github.com/hengchuanmalu/aure/issues) · [参与贡献](CONTRIBUTING.md)

## 功能

- **组织图库**：写真集与模特资料、多模特关联、标签分组、收藏、喜欢和评分。
- **连续浏览**：图片与视频查看器、搜索与筛选、最近浏览、连续滚动；写真集内照片在前、视频在后。
- **本地导入**：从写真、模特或写真总目录导入；读取 `album.json`，也可按本地文本规则提取资料，无法确定的字段留空。
- **保留原件**：引用导入，不移动、复制、重命名或改写媒体；重复目录跳过，不覆盖手动修改。
- **维护资料**：按需缩略图、常见 EXIF 与视频信息、缺失文件重新关联、目录重扫与重新定位。
- **本地数据**：SQLite 元数据备份与恢复；可选目录同步默认关闭。无需账号，没有云同步。

首次启动为空图库，不附带人物资料或个人媒体。测试使用程序生成的几何图片和视频，不随应用分发。

## 下载与使用

前往 [GitHub Releases](https://github.com/hengchuanmalu/aure/releases) 下载 Windows x64 版本。`v0.1.0` 是早期预览版。

| 文件 | 用途 |
| --- | --- |
| `aure-0.1.0-windows-x64-setup.exe` | 安装版，安装程序和快捷方式；缺少或过旧的 WebView2 时尝试联网安装或更新。 |
| `aure-0.1.0-windows-x64.zip` | 直接运行版，解压后打开 `aure.exe`，包含许可证与第三方声明。 |
| `aure-0.1.0-windows-x64.exe` | 单独的可执行文件；分发时请同时保留 Release 中的许可证声明。 |
| `SHA256SUMS.txt` | 下载文件的 SHA-256 校验值。 |

1. 安装或解压程序，然后启动 aure。
2. 从写真库的导入入口选择本地目录。
3. 按写真集、模特或标签浏览，按需收藏和评分。

直接运行版仍将元数据和缓存保存到 Windows 用户数据目录；它不是将所有数据保存在 exe 旁的便携图库。升级前可在设置中备份元数据；备份不包含媒体原件。卸载程序与删除原件是不同操作。

### 系统要求

- Windows 10 22H2 / Windows 11，x64。Windows 7 / 8.1、32 位和 ARM64 不在当前验收范围。
- Microsoft Edge WebView2 Evergreen Runtime，保持更新；最低版本检查为 111。直接运行版需要预先安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。
- 媒体文件可读，当前用户的数据和缓存目录可写。

普通 JPEG / PNG / WebP / GIF / BMP 缩略图不依赖 FFmpeg。AVIF、超大 JPEG 缩略图、视频封面和信息、兼容播放副本需要本机 [FFmpeg / ffprobe](https://ffmpeg.org/download.html)，工具从 PATH 或 WinGet Links 查找，不随应用分发。视频播放取决于实际编码和 WebView2 解码能力，不能仅凭扩展名保证支持。

当前下载文件未进行代码签名，Windows 可能提示未知发布者。干净电脑、离线首装和不同硬件的验收仍待完成；具体范围见 [环境验收矩阵](design/spec/05-acceptance.md)。缺少 WebView2 时，安装版需要网络连接。

## 从源码运行

前端需要 Node.js 22.12+（建议 Node 24，见 `.node-version`）和 npm。Windows 桌面开发还需要 Rust MSVC 工具链、Microsoft C++ Build Tools 的「使用 C++ 的桌面开发」、Windows SDK 与 WebView2，参阅 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。

```powershell
git clone https://github.com/hengchuanmalu/aure.git
cd aure
npm ci
npm run tauri -- dev
```

只预览前端时运行 `npm run dev`，打开 `http://127.0.0.1:1420`。浏览器预览使用 localStorage，不支持真实目录导入，不能替代桌面验收。

桌面开发会读取同一 Windows 用户的既有 aure 图库。写入测试必须使用独立 identifier 与可丢弃数据库，见 [贡献指南](CONTRIBUTING.md)。

## 构建与验证

```powershell
# 类型、依赖边界、前端构建、体积预算和单元测试
npm run verify

# 原生单元测试
cargo test --locked --manifest-path src-tauri/Cargo.toml

# Windows 可执行文件与 NSIS 安装程序
npm run desktop:package
```

直接运行文件位于 `src-tauri/target/release/aure.exe`，安装程序位于 `src-tauri/target/release/bundle/nsis/`。打包前生成第三方许可声明，开发环境要求同上。

浏览器交互测试使用 Microsoft Edge，需先启动 `npm run dev`，再另开终端运行 `npm run test:e2e`。发布验证流程及原生隔离测试见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 项目结构

React 19、TypeScript、Vite、Tailwind CSS、shadcn/ui / Radix、Lucide 与 Motion 构建界面；Tauri 2、Rust 和 SQLite 提供桌面能力与本地持久化。

| 目录 | 内容 |
| --- | --- |
| `src/domain/` | 领域类型、查询、排序与布局计算 |
| `src/application/` | 保存、关联、标签和导入规则 |
| `src/infrastructure/`、`src/state/` | 平台适配、存储与状态编排 |
| `src/pages/`、`src/features/`、`src/ui/` | 页面、编辑器、查看器与共享组件 |
| `src-tauri/src/` | SQLite、文件授权、媒体协议与原生命令 |
| `tests/` | 单元、浏览器与原生测试，以及合成素材 |

产品与交互约定见 [设计规范](design/README.md)，图库性能与分页快照契约见 [大规模图库规范](design/spec/06-large-library.md)。

## 反馈与贡献

发现问题或提出功能建议，请在 [Issues](https://github.com/hengchuanmalu/aure/issues) 中说明复现步骤、版本、Windows / WebView2 环境和预期结果。截图与日志请移除个人媒体、路径和敏感信息。

欢迎通过 Pull Request 贡献。开始前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全漏洞按 [SECURITY.md](SECURITY.md) 私密报告。项目由 [@hengchuanmalu](https://github.com/hengchuanmalu) 维护。

## 许可证

项目采用 [MIT](LICENSE)。第三方代码与资源保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；二进制分发的全文声明位于 `resources/third-party-licenses.txt`，也随 Release 提供。用户导入的媒体权利归各自权利人。

维护者发布源码时，使用 [开源导出流程](docs/open-source.md) 排除本地 Git 历史、私人协作文件、参考工程、备份和图库。
