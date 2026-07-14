# Implementation Status

## Phase 0 — 技术尖峰

状态：完成。

### 已实现

- TypeScript strict、React 18、Webpack 5、UXP panel；
- Photoshop 2022 23.3+ 兼容 Manifest v5（`minVersion: 23.3.0`、`apiVersion: 2`）；
- UXP 本地 `.xlsx` 二进制选择与读取；
- JSZip ZIP entry 列表与指定图片提取；
- UXP 临时文件写入和任务结束清理；
- `executeAsModal` 内的新文档、画板、嵌入式置入、contain 缩放定位和 PSD 保存；
- 明确错误、取消检查和失败时关闭未完成的新文档；
- `dist/` 生产构建。

### 真机验证

- 操作系统：Windows；
- Photoshop：2024（25.4.0）；
- 结果：用户确认 Phase 0 端到端测试通过；
- 已确认面板加载、新文档与 148×148 画板、嵌入式智能对象、缩放定位、PSD 重开、临时图片清理后仍显示，以及原活动文档不被修改；
- 耗时：本轮未记录。

此前 UXP Developer Tool 的 `Devtools: Failed to load the devtools plugin.` / IMS 用户配置问题属于已解除的历史阻塞，不再阻止阶段退出。Photoshop 2022 与 macOS smoke test 仍留待产品化阶段补齐。

## Phase 1 — XLSX 只读解析器

状态：完成。

### 已实现

- `XlsxArchive` ZIP 读取边界；
- `workbook.xml` 与 workbook relationships；
- shared strings，包括 rich text 与空字符串；
- sheet cells，包括 shared string、inline string、boolean 与公式缓存值；
- sheet drawing relationships；
- drawing relationships 与图片 archive entry；
- `oneCellAnchor` / `twoCellAnchor` 的 1-based 坐标；
- OOXML 相对路径与 ZIP entry 规范化；
- 腾讯 `xl/drawings/media` 和标准 `xl/media` 路径；
- 按工作表解析，不解压未选择图片；
- 损坏或缺失 drawing relationship 时明确报错；
- 不读取 `styles.xml`。

### 自动化验证

- TypeScript：`pnpm typecheck` 通过；
- 单元测试：8 个测试文件、21 个测试通过；
- 覆盖 workbook relationship、中文/英文/rich/空 shared string、inline string、boolean、公式缓存、空单元格、one/twoCellAnchor、两类 media 路径、损坏 styles 忽略、缺失 drawing rels 报错和非法锚点拒绝；
- 小型 fixtures：`tencent-export-minimal.xlsx`、`standard-media-minimal.xlsx`；
- 生产构建：由最终 `pnpm verify` 生成并校验 `dist/`。

### 真实样本验证

- `M图标月度安排1.xlsx`：80,002,558 bytes，23 个工作表，2,302 个 ZIP entries，全部解析完成；
- `M图标月度安排2.xlsx`：205,328,571 bytes，12 个工作表，2,603 个 ZIP entries，全部解析完成；
- `越南第三十九至四十一章`：699 个 cells、163 个图片锚点、163 个映射项目；
- `ds_vietnam1` → `xl/drawings/media/image2108.png`；
- `ds_vietnam3` → `xl/drawings/media/image2094.png`；
- `ds_vietnam52` → `xl/drawings/media/image2136.png`；
- 完整统计和复现命令见 `docs/PHASE1_PARSER_SUMMARIES.md`。

### Phase 1 退出条件

- 越南工作表可定位 `ds_vietnam1/3/52`：通过；
- 图片 entry 与当前样本一致：通过；
- 不读取 `styles.xml`：通过；
- 所有 parser tests：通过。

## Phase 2 — Manifest、映射、校验与选择

状态：代码与自动化验证完成；Photoshop UI 最终人工复核待完成。

### 已实现

- `AssetCandidate`、`ImageCandidate.thumbnailState`、`ValidationIssue.details` 与 GenerationJob 领域契约；
- code 发现、普通英文名称排歧、精确偏移和容错行扫描；
- 缺失/非法 code 的高可信结构化记录发现；
- sourceGroup 与稳定源表顺序；
- 解析 `mergeCells`，按最左侧 A 列建立可多选分组；一个组覆盖其右侧完整纵向行段；
- 只接受 A 列纵向 merge；忽略横向 merge、普通 A 列统计文字和无资源空模板；
- 连续同名分段合并为一个逻辑组；组间带资源的空白分段作为前组续段并写入诊断元数据；
- 首组前的空白资产段显示为“未命名分组”；无纵向 merge 的表回退为“全部已识别项目”；
- assetCode / numericId / 图片 / media type 校验；
- 多图片候选按上排参考图、下排项目图展示并默认选择下排；非法或陈旧候选 ID 保持阻断；
- 项目候选按 A 列分组采用类似 Photoshop 图层组的结构；每个分组只显示一个可折叠组头，图片旁显示 assetCode、名称和 ID；
- 移除独立的“检查与选择”步骤；统计、筛选、排序和批量选择合并为图片列表上方的紧凑工具栏，解析 Manifest 导出移至运行日志区域；
- 棋子链分组默认展开并可独立折叠，多排候选支持按图片排位批量选择；
- 主面板独立滚动，生成入口固定在候选列表上方；
- 缩略图按可视区域延迟加载，loading/ready/error 状态与实时数据 URI/LRU 上限均为 32；
- 切换工作表时旧解析结果立即失效；切换 A 列分组时当前任务范围即时更新；
- UI 显示 code/name/numericId 来源地址与图片 anchor entry；
- 存在任何 error 时禁用生成；
- 独立导出解析 Manifest 与 JSON Schema。

### 自动化验证

- TypeScript：`pnpm typecheck` 通过；
- 单元测试：14 个测试文件、51 个测试通过；
- 两个真实样本中的所有映射项目均被且仅被一个 A 列分组覆盖；
- 真实结构验证：中国“京菜”4 段合并为 A51:A70；意大利面系列 3 段合并为 A61:A75；巴西“桑巴滋味”包含 A57:A60 空白续段；
- 两个真实样本均完成 Phase 2 映射统计；
- `M图标月度安排1.xlsx`：1,888 项，2 个重复 code 项被阻断；
- `M图标月度安排2.xlsx`：2,096 项，403 个多候选均默认选择下排项目图，2,093 项无阻断错误；
- 详情见 `docs/PHASE2_MAPPING_SUMMARIES.md`。

### 待人工退出检查

- 在 Photoshop UI 中分别导入两份真实样本；
- 浏览多个工作表和长棋子链列表；
- 确认滚动时缩略图按需加载、收起分组不再继续解码不可见图片；
- 检查多图片候选的“参考图 / 项目图”标签、下排默认选择和手动切换；
- 确认面板可滚动到底部，棋子链可独立展开和收起；
- 确认重复 code 项目不可选，但同一范围内其他有效项目仍可生成；
- 导出一次解析 Manifest 并核对来源地址。

UXP Developer Tool 已成功加载最新构建，面板正常渲染；自动化复核因 Computer Use 窗口状态读取超时而停止，未伪称上述人工项已通过。

## Phase 3 — 批量 PSD 生成

状态：核心 Golden 43、PSD 重开、精确边界测量和中途取消真机验收通过；原活动文档隔离与跨版本 smoke test 待完成。

### 已实现与验证

- 主面板只保留“生成 N 个画板”；点击后通过 PSD 保存弹窗确定首卷名称和输出目录，只输出 PSD，后续分卷自动沿用同一前缀；
- 首卷 PSD 的同名覆盖确认完全交给系统保存弹窗；多卷时只预检不会再次弹窗的后续 PSD，检测到冲突时提示改名或更换目录；
- 2026-07-11 在 Photoshop 2024 v25.4.0 完成越南 Golden 43 项真机生成；
- 文档 2380 × 1140 px、300 ppi，43 个画板、43 个单子图层画板、43 个智能对象；
- Manifest 43 项、CSV 43 行且 assetCode 唯一，PSD 大小 5,921,640 bytes；
- 已存在目录重试时，同名预检在新文档创建前阻断并显示友好提示；
- 2026-07-12 加入 0.5 px 安全包络后重新生成 43 项；PSD 重开无修复提示，43 个智能对象的最大整数像素包络为 146 × 134 px，最大中心误差 X/Y 均为 0.5 px；
- 中途在 7/43 按 Esc 后，UI 显示完成 7/43，后续生成停止，新文档自动关闭且无 PSD、Manifest、CSV 残留；
- 每个新生成画板增加一个 `2048x2048_空白智能对象`：内部为 2048 × 2048 px 的嵌入式 PSB，主 PSD 中的变换四角精确为 148 × 148 px；完全透明内容使用 `smartObjectMore.transform` 测量，不依赖空的可见边界；
- 每个棋子画板最底层生成一个 `底板颜色` 填充层，默认 RGB(199, 212, 226)；“当前 PSD”可调用 Photoshop 拾色器统一改色，并统一显示或隐藏全部底板；
- 2026-07-12 Photoshop 2024 真机验证双击打开、内部编辑、保存回写和主 PSD 再保存全部成功，且删除外部临时 PSB 后仍可编辑；
- 自动化验证更新为 17 个测试文件、59 个测试，类型检查和生产构建通过；
- 详情见 `docs/PHASE3_GOLDEN_REPORT.md`。

## Phase 4 — 产品化

状态：进行中。

### 已实现与验证

- 新增“导出诊断包”入口，可在已有工作簿或仅有错误日志时导出；
- 诊断 ZIP 包含 `diagnostic-summary.json`、`logs.json`、`README.txt`，存在工作簿时另含 `parsing-manifest.json`；
- 诊断包只记录来源地址与元数据，不包含 XLSX 原文件或任何图片二进制；
- 超过 250 MB 的工作簿显示大文件模式提示，并继续按工作表、已选 A 列分组与可视区域按需处理；
- 诊断包自动化测试覆盖有工作簿与导入前错误两种状态，并校验 ZIP 中不存在图片/XLSX 文件。
- 选择 XLSX 后使用 UXP persistent token 记录最近工作簿，重新打开插件时提供“打开最近文件”入口；
- persistent token 不可用或因文件移动、删除、权限变化而失效时，清除失效记录，保留明确日志并回退到重新选择 XLSX；
- 最近文件记录采用带版本号的本地结构，异常 JSON、旧版本和非 XLSX 记录均会被拒绝。
- 工作簿导入完成后收起为文件名、工作表数和大小摘要；
- 导入工作簿后自动选择并解析第一个工作表；切换工作表会自动清空旧结果并读取新棋子链；
- 读取完成后保持范围展开，所有分组默认不选；选择范围后才显示候选列表与生成入口；
- 范围列表工具栏显示已选数量，并提供“全选 / 清空全选”两态按钮；
- 已删除筛选与批量操作模块，运行日志和诊断工具默认收起；
- 删除面板大标题、顶部说明、副标题、范围解释、重复的底部生成卡片、ZIP 入口数量和分组续段等低频信息；
- 主滚动区预留稳定滚动条空间，读取棋子链前后不再改变内容宽度，所有按钮保持一致的左右留白；
- 普通状态通知已移除；错误只在对应模块内显示，并自动展开运行与诊断；
- 错误项目自动取消选择并单独跳过，不再阻止同一范围中的其他有效项目生成；
- 生成前只检查后续自动分卷的 PSD 同名冲突；首卷按保存弹窗的覆盖选择执行，当前未完成 PSD 会自动清理，多卷失败时已完整分卷会明确保留；
- 生成流程不再自动创建同名 `.manifest.json` 与 `.report.csv`，诊断信息继续由“运行与诊断”按需导出；

### 待完成

- 模板编辑与保存；
- Windows/macOS 和 Photoshop 2022 跨版本 smoke test；
- `.ccx` 正式打包与非开发模式安装验证。

## 后续阶段

继续完成原活动文档隔离复核，并推进 Phase 4 的模板编辑、跨版本 smoke test 和正式打包。
