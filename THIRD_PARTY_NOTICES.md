# 第三方代码与资源

项目自身代码采用 [MIT](LICENSE)。第三方代码和资源保留各自许可，根目录许可证不替代这些声明。

| 内容 | 来源 / 许可 | 本地声明 |
| --- | --- | --- |
| shadcn/ui 基础组件 | [shadcn/ui](https://github.com/shadcn-ui/ui)，MIT | `src/components/ui/LICENSE.md` |
| Motion Primitives 适配组件 | [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives/tree/120f64f6ca60348e251f929e9c81f11ccbe45eda)，MIT | `src/components/motion-primitives/LICENSE.md`、`README.md`，打包副本 `public/licenses/motion-primitives.txt` |
| 社交平台图标 | [Simple Icons 16.3.0](https://github.com/simple-icons/simple-icons/tree/16.3.0)，CC0-1.0 | `public/social-icons/LICENSE.md`、`SOURCE.md`；品牌权利归各自权利人 |
| tw-animate-css | MIT，具体版本见锁文件 | `public/licenses/tw-animate-css.txt` |
| 搜索候选列表 cmdk | [dip/cmdk](https://github.com/dip/cmdk/tree/v1.1.1)，MIT | `public/licenses/cmdk.txt`，固定版本见锁文件 |
| 搜索排序 match-sorter 及 Rust 规则适配 | [kentcdodds/match-sorter](https://github.com/kentcdodds/match-sorter)，MIT，8.3.0 | `public/licenses/match-sorter.txt`；`src-tauri/src/catalog/MATCH_SORTER_LICENSE.md` |
| kamadak-exif、mutate_once | BSD-2-Clause，具体版本见 Cargo.lock | `public/licenses/kamadak-exif.txt`、`mutate-once.txt` |
| 测试图片和视频 | 由 `scripts/generate-fixtures.mjs` 生成的几何图案，随项目采用 MIT | `tests/fixtures/README.md`、`provenance.json` |
| aure 图标和品牌图 | 项目专用图像；本地生成记录为 imagegen，平台图标由 Tauri CLI 导出 | `resources/`、`src-tauri/icons/`、`public/brand.*`、`public/favicon.ico` |

运行时及开发依赖版本保存在 `package-lock.json` 和 `src-tauri/Cargo.lock`，依赖许可清单由开源准备命令生成在候选目录的 `docs/dependency-licenses.json`。`npm run licenses:generate` 根据已安装的 npm 运行时依赖及 Cargo Windows 依赖图，整理上游版权声明、包版本、源码链接和许可证全文到 `resources/third-party-licenses.txt`；原生构建依赖一并保留，收录不表示每个包都链接进程序。安装版将声明放在 `licenses/`，直接运行版压缩包也提供副本，重新分发时应保留。

清单中存在仅适用于对应依赖的其他许可，例如构建依赖 caniuse-lite 的 CC-BY-4.0、lightningcss 及部分 Rust 依赖的 MPL-2.0、Unicode 数据的 Unicode-3.0。不要将这些上游文件重新标注为 MIT；分发其源码、数据或实际链接的二进制时按对应条款保留声明与来源。

静态应用资源的来源与批准哈希记录在 `docs/public-assets.json`。新增或替换资源后需复核来源并更新清单，开源检查会拒绝未登记资源。

FFmpeg / ffprobe 从用户本机查找，不随应用分发。其构建选项、许可及编解码器相关要求取决于具体工具发行版；若未来打包这些工具，需单独核对 [FFmpeg 许可说明](https://ffmpeg.org/legal.html)。

历史概念图、个人参考工程及原有第三方测试照片不进入公开候选目录。MIT 不授予用户导入的个人媒体的权利。


