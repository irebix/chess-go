# 交给 Codex 的第一轮提示词

```text
请先完整阅读：
- AGENTS.md
- docs/01_PRD.md
- docs/02_TECHNICAL_DESIGN.md
- docs/03_ACCEPTANCE_TESTS.md
- docs/04_CODEX_EXECUTION_PLAN.md

本轮只执行 Phase 0 技术尖峰。不要提前实现完整 XLSX 解析器、完整步骤式 UI、批量 PSD、AI 或联网功能。

请在当前仓库中创建可由 Photoshop UXP Developer Tool 加载的 TypeScript + React + Webpack 项目，并完成：
1. 通过 UXP 文件选择器选择本地 .xlsx；
2. 以 ArrayBuffer 读取文件；
3. 使用 JSZip 列出 ZIP entries；
4. 从 fixtures/tencent-export-minimal.xlsx 验证并提取 xl/drawings/media/image1.png；
5. 把图片写入 UXP temporaryFolder；
6. 在新 Photoshop 文档中创建一个 148×148 px 画板；
7. 将图片以“嵌入式智能对象”置入该画板；
8. 按 fixtures/archive-148.template.json 的 contain、禁止放大、目标中心 (74,78) 规则完成缩放和定位；
9. 让用户选择输出位置并保存为 PSD；
10. 删除临时图片后，PSD 中图像仍应可见；
11. 添加最小日志、错误处理、取消检查和运行说明；
12. 更新 docs/IMPLEMENTATION_STATUS.md，明确区分“自动测试通过”和“待 Photoshop 真机验证”。

约束：
- 所有 Photoshop 写操作必须放在 core.executeAsModal 内；
- 优先 Photoshop DOM，画板和嵌入置入缺失能力再使用集中封装的 batchPlay；
- 不申请 network、webview、launchProcess 或 clipboard 权限；
- 不修改用户当前打开文档；
- TypeScript strict；
- 为 ZIP entry 提取、contain 缩放计算和路径规范化添加单元测试；
- 不要声称未在目标 Photoshop 中实际验证的 action descriptor 已通过。

完成后请输出：
- 新增/修改的文件列表；
- 构建与加载步骤；
- 自动测试结果；
- 需要我在 Photoshop 中逐项人工验证的清单；
- 当前风险和下一步，但不要开始 Phase 1。
```
