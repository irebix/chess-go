# 棋子go｜项目状态与会话交接

更新时间：2026-07-16
当前发布版本：`0.3.9`

## 一句话摘要

“棋子go”是一个 Photoshop 2023 24.2+ 的本地 UXP 面板：读取腾讯文档导出的 `.xlsx`，按 A 列棋子链分组和图片候选生成归档 PSD；可把 Excel 内嵌参考图提交到本机 ComfyUI 的 Holopix 工作流，生成、筛选候选并回填画板智能对象。

## 仓库与发布

| 用途 | 本地路径 | 分支 | 当前基线 |
| --- | --- | --- | --- |
| 源码、测试、文档 | `D:\Scripts\UXP\PsdArchive` | `main` | `0.3.9`（以 `git log -1` 为准） |
| 同事安装用运行包 | `D:\Scripts\UXP\ChessGo-Release` | `release` | `0.3.9`（以 `git log -1` 为准） |

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
- “AI 生成”与“当前 PSD”使用相同的自动识别条件，仅在当前文档是可识别的棋子归档 PSD 时显示；无 Excel 参考图的棋子仍可生成 PSD，但不进入 Holopix 图生文任务。
- Holopix 候选数可设为 `1–4`；按棋子使用安全单队列，三张候选自动拆为 Holopix 支持的 `2 + 1` 批次；拆分批次只在首批运行图生文，后续批次复用首批真实提示词，保证同一行候选语义一致。
- Holopix 使用 `Excel 参考图 → HolopixUploadReference → HolopixImageToPrompt → 文字提示词 → HolopixGenerate`；`HolopixGenerate` 明确删除 `reference` 输入，因此不是图生图。
- 工作流用 `easy showAnything` 记录 `HolopixImageToPrompt` 的运行时文字输出；新生成和新历史候选会携带真实提示词，面板顶部按候选批次显示，不由插件自动编写。
- 生成节点强制 `aspect_ratio: 1:1`，本地 `ImageScale` 再把保存结果规范化为精确的 `1024×1024` 方图。
- Photoshop 25.4 不能稳定使用 UXP `<img>` 解码动态 Holopix 图片；候选预览改用零计费的 ComfyUI 本地工作流规范化为 `96×96` RGB JPEG，再由纯 JavaScript 解码为 RGBA 像素，并转成 UXP 支持的 Canvas 基础 `fillRect` 色块绘制，绕过宿主图片解码器和不受支持的 ImageData API。
- Excel 参考图使用 `object-fit: contain` 放入 `1:1` 方格：长边贴住方格边缘，短边留白，始终完整显示而不裁切。
- 候选方格保持 `1:1` 并直接显示安全缩略图；Canvas 内在尺寸与方格统一为 `64×64`，不再出现四周暗色留空。候选角标、A/B 标记和可见“选用”按钮均已移除，直接点击图片即可选中并回填。为兼容 Photoshop 25.4 的 UXP Canvas 合成与命中缺陷，Canvas 上保留 `64×64` 的近透明原生交互层，并由外层容器提供点击回退；只有已选项显示绿框，未选项保持普通灰框。
- “恢复已有候选（不生成）”从 ComfyUI 最近历史找回当前棋子链的 `Holopix/ChessGo` 输出，不提交 Holopix 生成工作流，供闪退后复用已付费生成的结果；恢复时以最新输出的真实提示词为批次边界，只合并提示词完全一致的候选，避免把旧任务图片混入当前候选排。
- 模型、强度、超时等参数直接读取 `Holopix.json`；插件只注入参考图路径、候选数量、请求 nonce、保存前缀和固定方图约束。
- 点击生成后直接提交 Holopix 工作流，不显示二次确认弹窗；自动化验证不提交真实生成任务。
- 选择候选后，插件在 `executeAsModal` 中替换同 assetCode 画板内的 `数字x数字_空白智能对象` 内容，再按替换前画板框等比 contain、居中，确保候选图不越出画板；没有匹配 PSD 时保留 UI 选择并明确提示未回填。
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
- `0.3.2`：根据 Photoshop 原生崩溃记录和 ComfyUI 输出时间线，移除候选区对本机 HTTP 原图的直接渲染，改用顺序读取的受限 JPEG data URL；生成并发降为单队列并补充阶段日志。
- `0.3.3`：二次崩溃证明压缩后的 JPEG 仍为 `1024×992`，解码时继续触发 Photoshop 25.4 原生访问冲突；改由 ComfyUI 先生成真正的 `96×96` 临时 PNG，插件校验 PNG 头尺寸后才显示，并在棋子任务间增加解码缓冲时间。
- `0.3.4`：真实 `96×96` PNG 在候选返回后仍触发相同 Photoshop 原生偏移崩溃，因此彻底取消 UXP 内的 Holopix 图片解码；候选方格改为“系统浏览器查看”和“选用回填”，并可从 ComfyUI 历史恢复已有候选而不重新生成。
- `0.3.5`：新增零计费安全预览工作流，把既有输出经 ComfyUI `LoadImage → ImageScale → PreviewImage` 规范化为 `96×96` RGB JPEG；插件使用 `jpeg-js` 纯 JavaScript 解码，再量化为 `48×48` Canvas 基础色块绘制，不再调用 UXP `<img>` 解码器。候选矩阵和已选链均恢复面板内预览，失败时继续保留外看/选用。
- `0.3.6`：Holopix 改为真正的提示词-only 工作流，不再上传 Excel 参考图；提示词支持节点占位符并在面板顶部显示解析后的实际文本。生成强制 `1:1` 并规范化为 `1024×1024`；候选卡移除全部角标和选用按钮，点击图片选择，只有已选项显示绿框；回填后按原画板框重新 contain 和居中。
- `0.3.7`：纠正 `0.3.6` 对“不图生图”的误解，恢复 Excel 参考图上传和 Holopix 图生文，但彻底断开生成节点的 `reference`，形成图生文再文生图；记录并显示图生文节点真实输出。候选缩略图外层从 UXP 原生按钮恢复为已验证的普通容器，保留整图点击和仅已选绿框，修复 Photoshop 25.4 中按钮内 Canvas 不显示。
- `0.3.8`：修复 `0.3.7` 扁平化候选 DOM 后多 Canvas 只显示少量缩略图的回归；恢复 v0.3.5 已验证的 `Canvas + 原生交互层` 合成结构，但交互层完全透明，因此界面仍无角标和选用按钮。Excel 参考图改为长边贴边的 `contain` 显示，不再按短边铺满裁切。
- `0.3.9`：候选 Canvas 与方格统一为 `64×64` 满格显示；原生交互层改为 UXP 可稳定命中的近透明表面，并增加容器点击回退。历史恢复按最新真实提示词隔离批次，不再把旧任务的第二张图片拼进当前行；三候选 `2 + 1` 拆批时后续生成复用首批图生文提示词。

## 验证状态

- 最近一次 `pnpm verify`：通过。
- TypeScript strict：通过。
- Vitest：`28` 个测试文件、`105/105` 测试通过。
- Webpack production build：通过；仅有 `main.js` 体积建议警告（约 426 KiB），不是构建失败。
- `dist` 与发布仓库运行文件哈希一致。
- Photoshop 2024 实机已重启并加载 `0.3.4`：导入 1.2 MB 带图 Excel、选择 9 个参考图后，用“恢复已有候选（不生成）”找回 5 张历史候选；候选仅显示“查看 / 选用”，持续观察 30 秒 Photoshop 未闪退，且没有新增应用崩溃事件。
- Photoshop 2024 实机已通过 UXP Developer Tools 热重载 `0.3.5`：导入同一带图 Excel、选择清洁工具链后，从 ComfyUI 历史恢复并直接绘制 `18/18` 张候选；持续观察 30 秒面板保持可用、Photoshop 正常响应，新增应用崩溃事件为 `0`，日志确认未提交新生成任务。
- Photoshop 2024 已热重载 `0.3.6`：面板顶部正确显示“清洁布”的解析后实际提示词，并明确提示“不读取或上传参考图”；本机 `object_info` 确认 `HolopixGenerate.reference` 为 optional、`ImageScale` 支持当前方图参数。UI 自动化定位浮动 UXP 面板时两次误点生成按钮，共提交了 2 个“清洁布”单图任务；历史记录确认两次请求均为纯文本、`aspect_ratio=1:1`、不含 `reference`，输出 `c_cleaning1_00008_.png`、`c_cleaning1_00009_.png` 均为实际 `1024×1024`，检查结束时 ComfyUI running/pending 队列均为 `0`。未继续点击候选回填，以免改动用户当前未保存 PSD。
- `0.3.7` 已通过本机 ComfyUI 零付费节点实测：从既有输入图仅运行 `LoadImage → HolopixUploadReference → HolopixImageToPrompt → easy showAnything`，约 3 秒后历史输出真实中文提示词；该验证没有包含或执行 `HolopixGenerate`。`object_info` 同时确认 `HolopixGenerate.reference` 为 optional，发布工作流中该输入不存在。
- Photoshop 2024 已热重载 `0.3.8`：重新打开当前 PSD 与最近 Excel，选择清洁工具链后用“恢复已有候选（不生成）”恢复 `18/18` 张历史候选；上下滚动逐行确认 9 个节点、18 张 Canvas 缩略图全部可见。纵向和横向 Excel 参考图均按长边贴边完整显示，无裁切；面板状态和日志确认未提交新生成任务，也未点击候选回填。检查结束时 ComfyUI running/pending 均为 `0`，Photoshop 继续响应，最近 30 分钟新增 Photoshop 崩溃事件为 `0`。

## 仍需人工验证

- 在 Photoshop 中重载 `0.3.9`，恢复现有历史候选；当前历史每行应只显示最新提示词批次的一张候选，旧提示词任务不再被拼成第二张。
- 点击候选方格的中央与边缘，确认都能稳定切换；仅当前候选显示绿框，并且回填只执行一次。
- 确认候选图铺满 `64×64` 方格；如实际生成三张候选，确认 `2 + 1` 两批图片显示同一条 Holopix 图生文提示词。
- 启动本机 `127.0.0.1:8188` 的 ComfyUI，并确认 `LoadImage`、`HolopixUploadReference`、`HolopixImageToPrompt`、`HolopixGenerate`、`ImageScale`、`SaveImage` 和 `easy showAnything` 节点可用。
- 导入含内嵌图片的 Excel、选择棋子链；确认参考图进入图生文节点，顶部在生成/恢复后显示 Holopix 返回的真实提示词，同时确认 `HolopixGenerate` 不含 `reference` 输入。
- 点击真实生成时确认不再出现二次弹窗；整张候选图可点击选中并替换对应 assetCode 画板的空白智能对象。
- 点击一个已有候选，确认只有当前选中候选显示绿框；确认回填后的智能对象完整位于原画板框内且没有溢出。
- 修改发布目录的 `Holopix.json` 模型、强度或超时后重载插件，确认图生文和文生图共同使用节点参数；生成比例仍固定为 `1:1`。
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
