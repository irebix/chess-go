# AGENTS.md — 棋子go

本仓库用于实现一个 **Photoshop UXP 本地插件**：用户从腾讯文档下载 `.xlsx` 副本，在 Photoshop 内导入、选择工作表与范围、校验图标需求，并生成归档 PSD。

## 必须遵守

1. **只做本地方案。** MVP 不接腾讯文档链接、OAuth、后台服务、网络请求或回写接口。
2. **输入是 `.xlsx`，但不要做“通用 Excel 编辑器”。** 只支持本文档定义的腾讯文档导出结构与可配置行偏移。
3. **不要使用 openpyxl 思路照搬到前端。** 样本中的 `styles.xml` 存在兼容性问题；插件必须直接读取 ZIP/XML，只解析所需结构，不解析样式。
4. **业务主键是 `assetCode`**（例如 `ds_vietnam3`）；数值型 `numericId`（例如 `200975`）是附加字段。PSD 画板名使用 `assetCode`。
5. **任何 Photoshop 写操作必须在 `executeAsModal` 中运行。** 长任务要支持取消并定期 `await`。
6. **优先 DOM，缺失能力再用 `batchPlay`。** 画板创建和嵌入式置入可使用记录得到的 actionJSON；描述符必须集中封装，不能散落在 UI 代码中。
7. **生成新文档，不修改用户当前文档。** 失败时不得污染原文档。
8. **不静默跳过异常。** 缺 `assetCode`、重复 `assetCode`、无图片、图片候选不唯一，必须阻断对应项目生成。
9. **内存按需使用。** 不一次性解压全部图片；只读取被选工作表和被选项目的图片。缩略图分页/按需解码。
10. **TypeScript strict。** 核心解析、布局和校验逻辑必须有单元测试。

## 实施顺序

严格按 `docs/04_CODEX_EXECUTION_PLAN.md` 执行：

- Phase 0：技术尖峰，先用 `fixtures/tencent-export-minimal.xlsx` 证明“解析一个图 + 生成一个画板 + 置入智能对象 + 保存 PSD”。
- Phase 1：XLSX 只读解析器。
- Phase 2：Manifest、校验和范围选择。
- Phase 3：PSD 批量生成。
- Phase 4：完整 UI、报告、性能与打包。

每个 Phase 结束时：

- 运行单元测试；
- 更新 `docs/IMPLEMENTATION_STATUS.md`；
- 记录已验证的 Photoshop 版本、系统和耗时；
- 不提前实现后续 Phase 的非必要功能。

## 明确不做

- AI 菜名识别、相似资产检索、自动绘图；
- 腾讯文档链接直读；
- 浏览器插件；
- 云服务；
- 任意 Excel 布局识别；
- 自动描边或矢量化；
- 修改已有 PSD；
- 多人协作、权限、审批流。
