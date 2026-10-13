# 合成测试素材

本目录的 JPEG 是程序生成的渐变、条纹与圆形；MP4 是 FFmpeg testsrc2 生成的几何测试视频。没有人物照片、真实图库或外部媒体输入，随项目采用 MIT。

历史文件名仅用于保留现有测试引用。宽高与顺序保持稳定，大小和 SHA-256 见 media-manifest.json 与 provenance.json。

重新生成：在 PATH 配置 FFmpeg 后执行 `npm run fixtures:generate`。普通测试使用已经提交的素材，不需要 FFmpeg。素材只在开发服务器用于测试，不随应用打包。
