# Motion Primitives 来源

直接接入 [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives)，MIT；固定提交 `120f64f6ca60348e251f929e9c81f11ccbe45eda`（2026-10-09 核对）。对应原文件：`components/core/transition-panel.tsx`、`components/core/animated-background.tsx`。许可证见本目录 `LICENSE.md`，打包副本位于 `public/licenses/`。

本地适配包括项目导入、类型、退出分区 inert、选中值受控、保留按钮事件与行内布局、减少动态效果关闭共享布局。应用配方由 `src/ui/MotionPanel.tsx`、`MotionSelection.tsx` 提供；不把库参数升级为个人偏好。

CSS 弹层和复选标记直接使用现有 MIT 依赖 [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) 1.4.0 的 enter/exit 资产，局部参数在 `src/styles/motion.css`。未引入额外动画运行时，也未采用 Pro 或 Commons Clause 组件。
