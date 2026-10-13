# 开源准备与发布边界

本项目选择 MIT。公开源码前，应使用独立候选目录，保留本地开发仓库用于继续工作；旧 Git 历史包含曾经使用的第三方测试照片和历史设计图，不能仅靠 `.gitignore` 排除。参阅 [GitHub 对历史敏感数据的说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

## 生成候选目录

```powershell
npm run check:open-source
npm run prepare:open-source
```

导出目录为 `output/open-source/aure-<时间戳>/repository/`，命令会输出绝对路径。按明确文件清单复制当前源码，不复制 `.git`、`AGENTS.md`、历史概念图、图册、生成报告、参考工程、图标生成提示词、构建产物或本地图库。不会暂存、提交、改写历史、修改远程地址或推送。

公开目录的 `design/README.md` 只链接随仓库提供的规范。来源目录中忽略规则不会移除已经跟踪的文件，因此不要直接对现有仓库执行 `git add .` 后推送旧历史。

候选目录旁的 `manifest.json` 包含每个公开文件的大小和 SHA-256；`audit.json` 记录本次检查、依赖许可状态和源历史的启发式扫描结果。报告与旧历史均不进入公开仓库。新增文件不会自动进入导出清单，需在 `scripts/prepare-open-source.mjs` 中明确纳入。

自动检查拒绝私钥、常见令牌、凭据赋值、个人目录、可疑数据库 / 备份文件、不安全链接及超过 GitHub 单文件限制的文件，并校验合成测试素材的来源清单。扫描只覆盖已列出的模式，不证明全部秘密或素材权利已排除；发布前仍应复核文件清单和实际截图。

## 测试素材

原有外部人像与视频已移入本地忽略的备份。公开素材由 `scripts/generate-fixtures.mjs` 生成，保持既有文件名、宽高和查看顺序；这些历史文件名不表示第三方照片仍被使用。`tests/fixtures/provenance.json` 记录生成版本与实际文件哈希。重新生成需要本机 FFmpeg，可运行 `npm run fixtures:generate`；普通构建与测试使用仓库内已生成的素材，无需重新生成。

历史概念图不作为当前截图发布。若补充 README 展示图，使用合成素材和可丢弃浏览器数据生成，复核姓名、路径、标签及背景。

## 在候选目录验证

```powershell
npm ci
npm run check:open-source
npm run build
npm run check:performance
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

开发验证可启动 `npm run dev` 后另开终端执行 `npm run test:e2e`。生产构建验证在构建后启动 `node scripts/preview-browser-tests.mjs`，在测试终端设置 `$env:AURE_BROWSER_BASE_URL='http://127.0.0.1:1421'` 后执行 `npm run test:e2e`。该服务器只在回归时单独提供合成媒体，素材不进入 `dist` 或桌面程序。GitHub CI 在 Windows 上运行前端预算检查、Rust、桌面编译及生产构建的 Edge 交互测试；工作流已准备好，实际云端结果需首次推送后确认。CI 不启动或修改个人正式图库。

依赖清单 `docs/dependency-licenses.json` 根据 npm 锁文件及 Cargo 元数据生成，包含开发依赖；未识别许可会令导出失败。清单不替代各第三方的许可证全文。源码公开和二进制发行是不同准备项：首次发布 exe 前应另行核对全部实际链接依赖的声明、安装方式、版本与媒体兼容性。

## 公开时再确定

1. GitHub 账号、仓库名、公开范围，以及首次提交使用的公开昵称与邮箱。
2. 在 GitHub 创建空仓库，从已复核的候选目录建立新的 Git 历史，勿拷入旧 `.git`。
3. 显式授权后再提交与推送；本地准备命令不会执行这些操作。
4. 启用私密漏洞报告，检查 Actions 结果和仓库安全设置；需要时设置默认分支保护。
5. README 展示图和首个 Release 单独验收，目前不自动发布安装包。

建议首发仓库描述：`Windows 本地优先的写真、图片与视频管理应用，基于 React、Tauri 和 SQLite。`
