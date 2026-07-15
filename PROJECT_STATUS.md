# 棋子go｜项目状态与会话交接

更新时间：2026-07-15  
当前发布版本：`0.3.1`

## 一句话摘要

“棋子go”是一个 Photoshop 2023 24.2+ 的本地 UXP 面板：读取腾讯文档导出的 `.xlsx`，按 A 列棋子链分组和图片候选生成归档 PSD；可把 Excel 内嵌参考图提交到本机 ComfyUI 的 Holopix 工作流，生成、筛选候选并回填画板智能对象。

## 仓库与发布

| 用途 | 本地路径 | 分支 | 当前基线 |
| --- | --- | --- | --- |
| 源码、测试、文档 | `D:\Scripts\UXP\PsdArchive` | `main` | `0.3.1`（以 `git log -1` 为准） |
| 同事安装用运行包 | `D:\Scripts\UXP\ChessGo-Release` | `release` | `0.3.1`（以 `git log -1` 为准） |

远端公开仓库：`https://github.com/irebix/chess-go.git`。`main` 与 `release` 是同一远端的独立分支，不是嵌套目录；本地使用两个并列工作目录维护。发布分支不包含开发文档与源码。

## 当前可用功能

- 导入本地 `.xlsx`，记住最近工作簿并可重新打开。
- 自动选择第一个工作表；切换工作表时自动解析棋子链。
- 按 A 列连续分组选择范围，默认不全选，工具栏提供“全选 / 清空全选”。
- 多排图片候选全部展开，支持按排位批量选图；单个棋子某一排缺图时不强制匹配。
- 缩略图可见区域延迟加载，限制实时缩略图与缓存数量，避免大表卡顿和闪烁。
- 非标准或缺失 `assetCode`、无关联图片都保留提醒但不阻断生成；无关联图片的项目仍创建画板与空白智能对象，只是不放参考图。
- 只生成 PSD。首次保存由 Photoshop 弹窗命名；多卷自动续号，并在生成前检查后续同名冲突。
- 每个棋子画板包含参考图和嵌入式空白智能对象；空白智能对象边长可配置，默认 `1024 px`，画板内显示为 `148×148 px`。
- 画板间距默认 `50 px`；智能对象边长和画板间距会恢复用户上次的合法输入。
- 生成的 PSD 可隐藏/恢复参考图，并记录切换前的图层可见状态。
- 可显示/隐藏分组框；分组框由底层分组画板实现。
- 可统一修改原生画板背景颜色，也可隐藏为透明并恢复设置颜色。
- 布局元数据存放在默认折叠的隐藏数据组，供分组框与底板控制使用。
- “AI 生成”与“当前 PSD”使用相同的自动识别条件，仅在当前文档是可识别的棋子归档 PSD 时显示；参考图固定取当前棋子链中已选择的 Excel 内嵌图片。
- Holopix 候选数可设为 `1–4`；按棋子并发 `2` 项，三张候选自动拆为 Holopix 支持的 `2 + 1` 批次。
- 候选矩阵使用 `1:1` 参考图和候选缩略图，显示排队/生成/完成/失败/已选状态；支持失败重试、单格重生成和已选链预览。
- 提示词完全沿用 `HolopixGenerate.prompt` 在 `Holopix.json` 中配置的文本或节点连线；模型、强度、比例、超时等参数也直接读取工作流，不生成或覆盖提示词。
- 点击生成后直接提交 Holopix 工作流，不显示二次确认弹窗；自动化验证不提交真实生成任务。
- 选择候选后，插件在 `executeAsModal` 中替换同 assetCode 画板内的 `数字x数字_空白智能对象` 内容；没有匹配 PSD 时保留 UI 选择并明确提示未回填。
- 运行日志和诊断默认收起；可以导出不包含 XLSX 与图片二进制的诊断 ZIP。

## 主要代码入口

- 面板与交互：`src/app/App.tsx`
- AI 候选矩阵：`src/app/AiGenerationPanel.tsx`
- Holopix 工作流适配与 ComfyUI 客户端：`src/ai/holopixWorkflow.ts`、`src/ai/holopixClient.ts`
- 候选回填：`src/photoshop/aiCandidateBackfill.ts`
- 样式：`src/styles.css`
- 批量 PSD 生成：`src/photoshop/batchGenerator.ts`
- 参考图与当前 PSD 控制：`src/photoshop/referenceViewController.ts`
- 分组框及布局元数据：`src/photoshop/groupArtboardOverlay.ts`、`src/domain/groupLayoutMetadata.ts`
- 原生画板底板：`src/photoshop/artboardBackgroundController.ts`
- XLSX 解析：`src/infrastructure/xlsx/`
- A 列分组和映射：`src/domain/sheetGroups.ts`、`src/domain/mapper.ts`
- 生成参数记忆：`src/domain/generationSettings.ts`、`src/services/GenerationSettingsService.ts`
- Windows 安装器源：`installer/install.cmd`
- 发布同步：`scripts/publish-release.ps1`

## 最近完成

- `0.2.4`：安装器先比较 GitHub 远端版本；相同版本跳过 Git，有更新时优先 Git，Git 通道失败后回退到 Codeload 精确提交压缩包。
- `0.2.5`：在画板间距上方增加“智能对象边长”，默认 `1024 px`；实际创建对应尺寸的正方形 PSB，图层名带尺寸，画板内仍为 `148×148 px`。
- `0.2.6`：画板间距默认从 `100` 改为 `50 px`；用 `localStorage` 持久化智能对象边长和画板间距，只记录两项都合法时的最新值。
- `0.2.7`：无关联图片改为非阻断提醒；继续生成不含参考图的画板与空白智能对象，并保留分组框和底板控制。
- `0.3.0`：接入 Excel 参考图 → Holopix → AI 候选矩阵 → 画板智能对象回填流程；增加 UXP 兼容面板、付费确认、批量并发、单格重试和可直接编辑的 `Holopix.json`。
- `0.3.1`：根据诊断包修复 UXP `Manifest entry not found` 网络权限；AI 栏跟随当前 PSD 自动显隐，缩略图改为 `1:1`，提示词只来自工作流，并取消生成前弹窗。

## 验证状态

- 最近一次 `pnpm verify`：通过。
- TypeScript strict：通过。
- Vitest：`24` 个测试文件、`88/88` 测试通过。
- Webpack production build：通过；仅有 `main.js` 体积建议警告（约 392 KiB），不是构建失败。
- `dist` 与发布仓库运行文件哈希一致。
- `main` 与 `release` 在整理本文档前均为干净工作区并与远端一致。

## 仍需人工验证

- 重启 Photoshop 使 `0.3.1` Manifest 生效；确认普通 PSD 不显示“AI 生成”，识别到棋子归档 PSD 后在“当前 PSD”和“生成 PSD”之间自动显示。
- 启动本机 `127.0.0.1:8188` 的 ComfyUI，并确认 `HolopixUploadReference`、`HolopixImageToPrompt`、`HolopixGenerate`、`SaveImage` 节点可用。
- 导入含内嵌图片的 Excel、选择棋子链；确认参考图和候选缩略图均为 `1:1`，工作流提示词卡显示 `HolopixGenerate.prompt` 的文本或来源节点。
- 点击生成时确认不再出现二次弹窗，并执行一次真实 Holopix 生成；选择候选，确认对应 assetCode 画板的空白智能对象被替换，其他画板和参考图不变。
- 修改发布目录的 `Holopix.json` 模型、强度或比例后重载插件，确认面板提交沿用节点参数。
- 在 Photoshop 中确认仍显示 `智能对象边长 1024`、`画板间距 50`。
- 修改两个值、关闭并重新打开插件或重启 Photoshop，确认恢复上次合法输入。
- 用非 1024 边长生成 PSD，双击空白智能对象，确认内部 PSB 尺寸正确、编辑保存可回写，画板内外观仍为 `148×148 px`。
- 选择包含无关联图片提醒的棋子，确认仍生成画板和空白智能对象，且该画板没有参考图图层。
- 在同事机器运行 `release/install.cmd`，确认首次安装、同版本快速安装和网络受限时的 Codeload 回退。

## 新会话开始方式

1. 告诉 Codex 工作目录为 `D:\Scripts\UXP\PsdArchive`。
2. 要求先读 `AGENTS.md` 和 `PROJECT_STATUS.md`。
3. 说明本次要改的 UI 或 Photoshop 行为，并提供截图/诊断 ZIP（如有）。
4. 修改后要求运行 `pnpm verify`；准备给同事更新时再同步并推送 `release`。
