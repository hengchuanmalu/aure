# 参与 aure

欢迎提交问题和 Pull Request。较大的功能、依赖或数据结构调整，请先说明目标、现有问题和兼容性影响。

## 本地开发

环境和启动方式见 [README](README.md)。使用 `npm ci` 和现有锁文件。前端代码按领域、业务、平台适配、状态和 UI 分层；页面不直接调用原生命令或扫描磁盘。修改 Rust 接口时同步核对 TypeScript 适配和迁移兼容性。

写真集中的照片在前、视频在后，各类型内部保留顺序。媒体原件与图库元数据分开处理；移出引用与删除原件是不同操作。不要把桌面分页快照当作完整图库覆盖保存。

## 提交前检查

```powershell
npm run verify
npm run check:open-source
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`verify` 与 CI 共用边界、类型、前端构建、首屏依赖闭包、发布体积和单元测试入口。行为变化再执行相关浏览器用例；界面显示检查实际截图。可启动 `npm run dev`，或用 `node scripts/preview-browser-tests.mjs` 服务刚构建的产物，并设置 `AURE_BROWSER_BASE_URL=http://127.0.0.1:1421` 运行生产浏览器回归。

媒体、窗口或原生命令变化需在 Windows WebView2 中验证，浏览器结果不能替代桌面验收。本机更新后先执行 `npm run check:installed`；共用安装版测试入口还会检查源码指纹与程序哈希，并由具体测试核对运行页面入口。原生写入测试使用独立应用 identifier 和可丢弃数据库，不连接个人正式图库。

PR 描述说明问题、结果、验证与未覆盖范围；附界面截图时只使用合成测试素材。不要提交个人写真、数据库、备份、凭据、参考工程或构建产物。新引入的组件、字体、图片和代码片段需要保留来源与许可声明。

## 发行前验证

发行候选必须冻结源码并按以下层次留存结果；构建期间或测试后再改源码，受影响的层次重新验证。每一层说明通过、失败、跳过和实际环境，不能把前端通过合并成桌面或干净电脑通过。

1. `npm ci` 后运行 `npm run verify:release`。需要已有 Microsoft Edge、Rust/MSVC 和 `cargo-audit`（可用 `cargo install cargo-audit --locked` 安装）。入口执行 `verify`、公开资源/许可检查、npm/RustSec 漏洞检查、全部 Rust 测试、安装备份与 Runtime 检测策略测试、原生脚本语法，再启动本次 `dist` 的专用生产预览运行全部浏览器用例，保留 `verification/release/gate.json` 与 RustSec JSON。`-SkipBrowser` 只用于浏览器已单独运行的分层检查，报告会标明跳过。RustSec 的维护、unsound 和撤回版本告警必须核对实际 Windows 依赖链并记录处置，不能仅凭 vulnerability 数量为零忽略。
2. `npm run desktop:build-test` 构建独立 identifier 的 Release 程序，默认位于 `src-tauri/target-release-audit`，附源码指纹、程序哈希和前端入口收据；不替换正式安装，也不改正式图库。设置下面的环境变量并启动后运行 `npm run test:native:release -- --isolated`。此入口顺序执行 10 万/30 万元数据与连续窗口、编辑/浏览/媒体旅程、维护事务、原生授权与文件边界、真实视频编码矩阵；任何一项失败就停止，后续项在 JSON 中保持待执行。编码矩阵需本机 FFmpeg/ffprobe。
3. 完成本机正式更新 `npm run desktop:update` 后先 `npm run check:installed`，再设置正式应用的 `AURE_CDP_URL`，运行 `npm run test:native:release -- --installed`。这层核对当前源码/EXE/运行入口，跨重载保护所有目录同步与图库写入，验证全部导航、真实缩略图、SQLite `integrity_check` 与 `foreign_key_check`、正式图库逻辑快照和暖查询采样。收尾恢复本地界面偏好，在保护内重载到发现页、等待当前数据及全部 IPC 响应完成，再移除保护并复核本轮图库快照，避免旧详情页的迟到浏览记录漏写。正式图库中没有对应内容时相关用例明确跳过，不添加素材；不使用先前日期的图库快照覆盖用户后续浏览或同步产生的数据。
4. 本机更新的 EXE、收据、图标和快捷方式作为一次替换处理；收据、图标或快捷方式写入失败时自动恢复前版本，首次安装失败时清理本次半成品。程序备份保留配套 `.metadata.json`，核对 EXE 和每份旧元数据的 SHA-256 后可恢复；备份轮转同步移除配套文件。自动回归在独立临时目录注入失败，不操作真实安装。数据库不在此替换事务内，程序回滚不能代替图库备份。
5. 按 [环境矩阵](design/spec/05-acceptance.md) 在干净标准用户环境检查首装/离线/缺 Runtime、实际系统 DPI、只读原件、权限与磁盘故障、移动盘/UNC/长路径、原生文件选择、升级保存和回滚。需要的外部电脑或真实系统条件不能靠浏览器模拟补成已验收。

```powershell
$env:AURE_NATIVE_IDENTIFIER = 'local.jingji.user-journey-audit'
$env:AURE_NATIVE_EXE = (Resolve-Path 'src-tauri/target-release-audit/release/aure.exe').Path
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9266'
$env:AURE_CDP_URL = 'http://127.0.0.1:9266'
Start-Process -FilePath $env:AURE_NATIVE_EXE -WindowStyle Hidden
npm run test:native:release -- --isolated
```

`tests/native/` 的其他脚本是特定改动的诊断，部分要求预先生成的 `verification` 素材、单独的 identifier、指定数据量或人工文件选择。不要枚举后全部连接正式图库运行，也不要把历史报告当作当前发行证据。现行 gate 输出在 `verification/native-release/`；原生写入测试只使用可丢弃素材并核对原件哈希。

媒体工具或退出流程变化时，单独运行 `node tests/native/native-shutdown.mjs`。先在 `verification/shutdown-audit/` 准备 `synthetic-progressive-large.jpg`（16000×16000 渐进 JPEG，触发超大图片的 FFmpeg 预览）与 `synthetic-video.ts` 合成素材，并执行 `npm run desktop:build-test -- -Identifier local.jingji.shutdown-audit -TargetDirectory src-tauri/target-automatic-import` 生成本次收据。退出脚本使用专属 identifier 和端口 9288，自行启动、正常关闭并启动新的应用进程，不需要先启动测试窗口。它覆盖工具运行与任务排队时关闭、子进程与临时文件清理、真冷重启后的基本页面及持久化读取，并核对测试源哈希和正式图库只读快照；报告留在 `verification/shutdown-audit/fixed-results.json`。此用例目前独立于默认原生 gate。页面重载、进程重启和启动耗时分别记录；没有计时与环境采样的启动行为验收不作为冷启动性能结果。

上述分层参考 [Playwright 隔离与自动等待](https://playwright.dev/docs/best-practices)、[生产 CI 与 trace](https://playwright.dev/docs/ci-intro)、[Tauri 原生测试](https://v2.tauri.app/develop/tests/webdriver/)、[Microsoft WebView2 测试](https://playwright.dev/docs/webview2)、[Runtime 分发检测](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) 与 [SQLite 完整性检查](https://sqlite.org/pragma.html#pragma_integrity_check)（2026-10-12 核对）。

## 目录

- `src/domain/`：类型、查询、排序、布局等纯计算。
- `src/application/`：保存、关联、标签、导入等业务规则。
- `src/infrastructure/`：存储与桌面平台适配。
- `src/state/`：共享状态和查询窗口。
- `src/pages/`、`src/features/`、`src/ui/`：页面、编辑器、查看器及共享 UI。
- `src-tauri/src/catalog/`：SQLite、事务、授权和媒体协议。
- `tests/unit/`、`tests/browser/`、`tests/native/`：各层验证；素材说明见 `tests/fixtures/README.md`。

## 长期维护约定

开始工作先读相关源码、锁文件和该问题的规范，保留工作区已有改动。产品目标以 `design/spec/01` 为入口，性能与快照契约以 `design/spec/06` 为入口，使用者环境以 README 和 `design/spec/05` 为入口；研究建议见 `docs/performance-guide.md`，不能当作已经实现的能力。

一次改动收敛到一个可说明的行为或资源瓶颈；先写清触发条件、正确结果及验证范围，再实施最小改变。同步核对 TypeScript、Rust 和浏览器回退，同类问题只沿共享机制排查。禁止用整库重写、静默清空、改原件或屏蔽失败来使测试通过。

修改读取窗口时必须检查所有消费者：展示只需窗口和摘要，编辑先明确读取完整关联，失败不能创建可保存的空草稿。异步提交要测试延迟、失败和后续重试；跨窗口旧草稿需要冲突协议，事务原子性不等于冲突安全。

性能验证记录构建哈希、硬件、缓存状态、媒体分布和采样范围；总量相同也应覆盖大单套、多模特、深度浏览后修改。发布体积、运行内存与派生缓存分开测量。已有预算通过不能代替冷启动、低内存或慢磁盘实测。

只更新已有权威文档中的稳定契约和重要决策，不维护每日开发流水账或另建整套 AI 交接资料。完成说明列出改变、实际检查与剩余限制；未执行的环境和场景保持待验收。
