# 棋子go｜项目状态与会话交接

更新时间：2026-07-16
当前发布版本：`0.5.0`

## 一句话摘要

“棋子go”是一个 Photoshop 2023 24.2+ 的本地 UXP 面板：读取腾讯文档导出的 `.xlsx`，按 A 列棋子链分组和图片候选生成归档 PSD；可把 Excel 内嵌参考图提交到局域网 ComfyUI 的 Holopix 工作流，生成、筛选候选并回填画板智能对象。

## 仓库与发布

| 用途 | 本地路径 | 分支 | 当前基线 |
| --- | --- | --- | --- |
| 源码、测试、文档 | `D:\Scripts\UXP\PsdArchive` | `main` | `0.5.0`（以当前分支 HEAD 为准） |
| 同事安装用运行包 | `D:\Scripts\UXP\ChessGo-Release` | `release` | `0.5.0`（以当前分支 HEAD 为准） |

远端公开仓库：`https://github.com/irebix/chess-go.git`。`main` 与 `release` 是同一远端的独立分支，不是嵌套目录；本地使用两个并列工作目录维护。发布分支不包含开发文档与源码。

## 当前发布快照

- `manifest.json` 与 `package.json` 均为 `0.5.0`。
- `main` 保存完整源码、测试和交接文档；`release` 只保存安装器及六个运行文件，不直接编辑构建产物。
- `D:\Scripts\UXP\PsdArchive\dist` 与 `D:\Scripts\UXP\ChessGo-Release` 六个运行文件的 SHA-256 全部一致。
- `0.5.0` 已完成自动化验证；Photoshop 最终交互验收继续由用户执行。

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
- 布局元数据存放在默认折叠的隐藏数据组，供分组框、底板控制和 PSD 独立恢复使用；成员记录在原有画板 ID、行、列之外兼容保存可选物品中文名称，不新增可见图层。旧版三字段成员数据仍可读取。
- “AI 生成”与“当前 PSD”使用相同的自动识别条件，仅在当前文档是可识别的棋子归档 PSD 时显示。AI 面板会只读扫描当前 PSD 中画板名称、`参考图` 图层与空白智能对象，并读取既有隐藏布局元数据中的真实链条标签、成员画板 ID、行列顺序和物品中文名称；恰好包含一个参考图和一个可回填智能对象的成员画板会按原链条重建，不依赖插件内存中的 Excel，也不依赖“生成 PSD”区域当前勾选的链或节点。名称同时用于矩阵第一行和 QwenVL“物件名字输入”，assetCode 保留在第二行；旧 PSD 没有成员名称且 Excel 不在内存时才回退 assetCode。参考缩略图直接把 Photoshop Imaging API 返回的 RGB/RGBA 原始像素转成 uncompressed ImageBlob，不再让 UXP `<img>` 解码 JPEG data URL；提交 QwenVL 时才只读编码为 JPEG。Photoshop 25.4 实机要求连 `imaging.getPixels` 只读调用也位于 modal scope，因此预览和 QwenVL 取图共用串行 `executeAsModal` 读取队列；固定 sRGB 配置失败时自动回退到文档/工作 RGB 配置。读取过程不写入、不修改 PSD。若对应 Excel 仍在内存中，优先复用名称等表格信息。
- Holopix 候选数可设为 `1–4`；按棋子使用安全单队列，三张候选自动拆为 Holopix 支持的 `2 + 1` 批次；拆分批次只在首批运行 QwenVL，后续批次复用首批真实提示词，保证同一行候选语义一致。
- Holopix 使用 `参考图 → LoadImage → AILab_QwenVL → 文字提示词 → HolopixGenerate`；当前物品的 `name` 注入标题为“物件名字输入”的 `PrimitiveStringMultiline`，再经 `StringFormat` 提供给 QwenVL。`HolopixGenerate` 明确删除 `reference` 输入，因此不是图生图。
- 标题为“提示词结果”的 `PreviewAny` 记录 QwenVL 的运行时文字输出；新生成和新历史候选会携带真实提示词，候选矩阵下方显示当前物品已选候选或首个候选的实际文本，不由插件自动编写。
- 候选矩阵下方的当前物品提示词可直接编辑；编辑框使用深灰底色并与矩阵左右对齐，隐藏 UXP 粗型原生滚动槽，右下角输入框内部的细纹把手可在 `86–360 px` 范围内只调整高度。“重新生成选中物品”会在该物品原候选右侧追加“每个物品生成”当前数量的新槽位，旧候选不覆盖。即使整条链仍在生成也可点击，新槽位立即显示排队状态并进入同一个 Holopix 安全单队列。该任务直接把用户文本交给 `HolopixGenerate.prompt`，不读取或上传参考图，并从本次提交图中移除 `LoadImage → 物件名字输入 → StringFormat → AILab_QwenVL` 执行链；“提示词结果”节点直接记录用户文本。常规批量生成和单格重试仍运行 QwenVL。
- 生成节点强制 `aspect_ratio: 1:1`，本地 `ImageScale` 再把保存结果规范化为精确的 `1024×1024` 方图。
- Photoshop 25.4 不能稳定使用 UXP `<img>` 直接解码动态 Holopix 的压缩 PNG/JPEG；候选预览先由零计费的 ComfyUI 本地工作流规范化为 `96×96` RGB JPEG，再用纯 JavaScript 解码为 RGBA 像素，并通过 UXP `ImageBlob({ type: "image/uncompressed" })` 生成高清 `<img>` Object URL。该路径不把压缩数据交给宿主原生解码器；ImageBlob 不可用时才退回低采样 Canvas。
- Excel 参考图使用 `object-fit: contain` 放入 `1:1` 方格：长边贴住方格边缘，短边留白，始终完整显示而不裁切。
- 候选方格保持 `1:1`，优先显示 `96×96` 原始 RGBA ImageBlob 高清缩略图；ImageBlob 失败时才使用候选槽位内独立 Canvas 的 `16×16` 采样色块兜底。候选行使用 `IntersectionObserver` 按可视区挂载并释放离屏 Object URL。矩阵内容本体不使用原生滚动，底部独立横向滚动条以 `scrollLeft → translateX` 同步水平位置，避免横向滚动容器吞掉顶层纵向滚轮。候选角标和可见“选用”按钮均已移除，只有已选项显示绿框。
- “恢复已有候选（不生成）”从 ComfyUI 最近历史找回当前棋子链的 `Holopix/ChessGo` 输出，不提交 Holopix 生成工作流，供闪退后复用已付费生成的结果；恢复时以最新输出的真实提示词为批次边界，只合并提示词完全一致的候选，避免把旧任务图片混入当前候选排。
- 运行时通过 UXP `getPluginFolder()` 读取当前实际加载插件目录根部的 `Holopix.json`：加载 `ChessGo-Release` 时即使用 `D:\Scripts\UXP\ChessGo-Release\Holopix.json`，加载 `dist` 时使用 `dist\Holopix.json`。首次读取后在当前插件会话内缓存，修改文件必须重载插件才生效。当前模板使用 QwenVL；插件运行时会注入或覆盖参考图路径、物品名称/用户提示词、候选数量、请求 nonce、付费确认、保存前缀、`1:1` 与 `1024×1024` 方图约束，并始终删除 `HolopixGenerate.reference`，因此不是原样提交整个 JSON。
- ComfyUI API、历史、上传、候选图和安全预览统一使用局域网端点 `http://192.168.1.32:8188`，不再生成 `127.0.0.1` 地址；本机 Comfy Desktop 的该安装实例已配置追加 `--listen 0.0.0.0`，监听所有 IPv4 接口，插件和浏览器仍使用具体可访问地址而不把 `0.0.0.0` 当作客户端地址。配置需重启 ComfyUI 后生效；本机同时存在以太网和 Tailscale，Windows 防火墙应把 8188 端口限制在可信网络范围。
- AI 面板只提交当前 PSD 范围内实际勾选、并且明确选择了 Excel 参考图的节点；不会因为选择了整条分组而把组内未勾选节点或默认第一张参考图一并提交。点击生成后直接提交 Holopix 工作流，不显示二次确认弹窗；自动化验证不提交真实生成任务。
- 候选生成或历史恢复后，直接点击候选即可立即替换对应画板的空白智能对象；同一行继续点击其他候选可在画板中换图对比。
- 选择候选后，插件先确认同 assetCode 只有一个目标画板与一个 `数字x数字_空白智能对象`，再在 `executeAsModal` 中替换内容；替换、缩放和平移后都按稳定的画板/图层 ID 重新取对象，即使 Photoshop 暂时把图层移出画板集合也不会误判丢失。定位优先使用自洽的 DOM `boundsNoEffects → scale(MIDDLECENTER) → translate(px)` 链；透明智能对象无有效 DOM 边界时，整条测量链统一退回 `smartObjectMore.transform`。若替换前后 Photoshop 把画板从局部坐标切换到文档坐标，目标框会按实际画板位移重新基准；执行后允许一次误差校正，并检查最终中心偏差与四边溢出。每次回填会把文档/画板/图层 ID、嵌套路径、artboardRect、DOM bounds、transform 四角、`target.rebased` 及各阶段误差写入诊断日志。
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
- `0.4.0`：候选矩阵改为每行单 Canvas、可视区挂载、滚动后强制重绘和单层外滚动，采样绘制量最多下降四分之三，降低 Photoshop UXP 的 surface 与合成压力。回填改为唯一目标校验、替换后重新取 Layer、同源 DOM/transform 测量、二次中心校正和最终溢出检查，并向诊断包记录完整几何链。
- `0.4.1`：根据实机诊断中 `c_cleaning1` 替换前 `0…148`、替换后 `1732…1880` 的坐标系跳变，把回填目标按替换前后画板位移重新基准，并改为用稳定画板/图层 ID 取回对象。候选 Canvas 改为命令式定点重绘、`16×16` 采样和纵向同色合并，避免滚动后整面板重渲染，并把单候选最坏绘制次数从 1024 降至 256。
- `0.5.0`：候选预览改用未经 PNG/JPEG 压缩的 UXP ImageBlob 原始 RGBA 路径并保留 Canvas 兜底；AI 范围可由当前 PSD 的参考图、唯一回填目标和隐藏布局元数据只读重建，恢复原链条、中文物品名和成员顺序。PSD 参考取像按 Photoshop 25.4 要求在串行 `executeAsModal` 中执行，但不写入文档。工作流切换到 QwenVL，物品名称进入“物件名字输入”，“提示词结果”保存真实提示词；提示词编辑框支持修改、纵向缩放，并可跳过 QwenVL 追加生成选中物品而不覆盖旧候选。候选矩阵使用可视区 ImageBlob、独立水平滚动条和持续扩展的候选槽位；生成与回填忙碌状态解耦，后续任务排队时已完成候选可立即回填。ComfyUI 统一改用局域网端点 `192.168.1.32:8188`，服务端配置为 `--listen 0.0.0.0`。

## 验证状态

- 最近一次 `pnpm verify`：通过。
- TypeScript strict：通过。
- Vitest：`32` 个测试文件、`132/132` 测试通过。
- Webpack production build：通过；仅有 `main.js` 体积建议警告（约 446 KiB），不是构建失败。
- `dist` 与发布仓库运行文件哈希一致。
- Photoshop 2024 实机已重启并加载 `0.3.4`：导入 1.2 MB 带图 Excel、选择 9 个参考图后，用“恢复已有候选（不生成）”找回 5 张历史候选；候选仅显示“查看 / 选用”，持续观察 30 秒 Photoshop 未闪退，且没有新增应用崩溃事件。
- Photoshop 2024 实机已通过 UXP Developer Tools 热重载 `0.3.5`：导入同一带图 Excel、选择清洁工具链后，从 ComfyUI 历史恢复并直接绘制 `18/18` 张候选；持续观察 30 秒面板保持可用、Photoshop 正常响应，新增应用崩溃事件为 `0`，日志确认未提交新生成任务。
- Photoshop 2024 已热重载 `0.3.6`：面板顶部正确显示“清洁布”的解析后实际提示词，并明确提示“不读取或上传参考图”；本机 `object_info` 确认 `HolopixGenerate.reference` 为 optional、`ImageScale` 支持当前方图参数。UI 自动化定位浮动 UXP 面板时两次误点生成按钮，共提交了 2 个“清洁布”单图任务；历史记录确认两次请求均为纯文本、`aspect_ratio=1:1`、不含 `reference`，输出 `c_cleaning1_00008_.png`、`c_cleaning1_00009_.png` 均为实际 `1024×1024`，检查结束时 ComfyUI running/pending 队列均为 `0`。未继续点击候选回填，以免改动用户当前未保存 PSD。
- `0.3.7` 已通过本机 ComfyUI 零付费节点实测：从既有输入图仅运行 `LoadImage → HolopixUploadReference → HolopixImageToPrompt → easy showAnything`，约 3 秒后历史输出真实中文提示词；该验证没有包含或执行 `HolopixGenerate`。`object_info` 同时确认 `HolopixGenerate.reference` 为 optional，发布工作流中该输入不存在。
- Photoshop 2024 已热重载 `0.3.8`：重新打开当前 PSD 与最近 Excel，选择清洁工具链后用“恢复已有候选（不生成）”恢复 `18/18` 张历史候选；上下滚动逐行确认 9 个节点、18 张 Canvas 缩略图全部可见。纵向和横向 Excel 参考图均按长边贴边完整显示，无裁切；面板状态和日志确认未提交新生成任务，也未点击候选回填。检查结束时 ComfyUI running/pending 均为 `0`，Photoshop 继续响应，最近 30 分钟新增 Photoshop 崩溃事件为 `0`。
- Photoshop 25.4 已热重载当前测试包：用户确认 ImageBlob 候选可正常加载且无闪退；清洁工具链取消勾选 `c_cleaning8`、`c_cleaning9` 后，AI 面板范围从 9 条准确变为 7 条，历史恢复也只恢复这 7 条且未提交新生成任务。点击 `c_cleaning1` 候选后已实际回填当前 PSD，最终图层边界为 `[1732,148,1880,296]`，中心误差 `[0,0]`、四边溢出均为 `0`。

## 仍需人工验证

- 当前最高优先级：连续点击同一行不同 ImageBlob 候选，确认每次回填后的智能对象都不漂移、不溢出画板，并且每次点击只回填一次。
- 用最新测试包重新生成 PSD 后，不重新打开 Excel 并热重载插件；确认链选择恢复原链条名字，矩阵第一行显示隐藏布局数据中的中文物品名（如“清洁布”）、第二行显示 assetCode，QwenVL“物件名字输入”也收到中文名。参考缩略图应通过 modal scope 内的只读取像和 uncompressed ImageBlob 显示成员画板的 `参考图` 图层，不再出现“未预览”或 `only allowed from inside a modal scope`。切换到另一份 PSD 后，链条与 AI 范围都应随当前文档变化。
- 从 PSD 单独恢复的节点运行一次真实生成，确认日志先显示只读提取 PSD 参考图，再上传并运行 QwenVL；生成前后 PSD 图层结构与历史状态不应因读取发生变化。
- 选择已有真实提示词的物品，编辑提示词后点击“重新生成选中物品”；确认旧候选保留，右侧按当前数量立即追加“排队中”槽位。整条链尚未完成时也应允许点击，新增任务等待前序任务后再生成；日志明确显示跳过参考图上传与 QwenVL，ComfyUI 历史中的本次生成直接使用修改文本。
- 重载 `0.5.0`，在候选矩阵上连续滚动鼠标滚轮，确认始终由最外层面板纵向滚动，没有矩阵内部上下抽动、卡死或抢滚轮；拖动底部横向滚动条时只发生水平位移。
- 在 2 张与 4 张候选两种宽度下左右拖动，确认标题、参考图、候选与选中蓝底同步移动；蓝底至少铺满可视区，并覆盖到最右候选之后。
- 真实生成期间确认已完成候选可以立即点击插入画板，后续节点继续排队；同时调整“每个物品生成”数量，确认当前批次不变、结束后候选槽位同步到新目标。
- 只勾选链内部分节点时，确认 AI 面板与提交任务只包含实际进入 PSD 且明确选择 Excel 参考图的节点。
- 在 Photoshop 中重载 `0.5.0`，恢复现有历史候选；连续上下滚动候选矩阵、折叠再展开 AI 栏并调整面板尺寸，确认候选会在进入视口后重绘，且不再随机空白或带动上下区域卡顿。
- 继续点击候选方格的中央与边缘，确认都能稳定切换；每行候选仍分别显示、只有当前候选显示绿框，并且每次点击只回填一次。
- 重启 Comfy Desktop 中的 ComfyUI，确认进程监听 `0.0.0.0:8188`，插件可通过 `192.168.1.32:8188` 连接，另一台可信局域网设备也能打开生成的 `/view` 地址；同时确认 Windows 防火墙没有把 8188 暴露给不可信网络，并确认 `LoadImage`、`PrimitiveStringMultiline`、`StringFormat`、`AILab_QwenVL`、`PreviewAny`、`HolopixGenerate`、`ImageScale` 和 `SaveImage` 节点可用。
- 导入含内嵌图片的 Excel、选择棋子链；确认物品名称进入“物件名字输入”、参考图进入 QwenVL，“提示词结果”在生成/恢复后显示 QwenVL 返回的真实提示词，同时确认 `HolopixGenerate` 不含 `reference` 输入。
- 点击真实生成时确认不再出现二次弹窗；整张候选图可点击选中并替换对应 assetCode 画板的空白智能对象。
- 点击一个已有候选，确认只有当前选中候选显示绿框；确认回填后的智能对象完整位于原画板框内且没有溢出。
- 修改发布目录的 `Holopix.json` QwenVL 参数、Holopix 模型强度或超时后重载插件，确认新参数生效；生成比例仍固定为 `1:1`。
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
