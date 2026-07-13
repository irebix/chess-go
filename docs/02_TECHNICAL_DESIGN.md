# 棋子go — 技术设计

## 1. 总体架构

```text
UXP Panel
│
├── FileImportService
│   └── 选择并读取本地 XLSX
│
├── XlsxReader（纯只读）
│   ├── ZipIndex
│   ├── WorkbookParser
│   ├── SharedStringsParser
│   ├── SheetParser
│   └── DrawingParser
│
├── RequirementMapper
│   └── Cells + ImageAnchors → AssetCandidate[]
│
├── Selection / Validation
│   └── GenerationJob
│
├── PhotoshopExecutor
│   ├── DocumentBuilder
│   ├── ArtboardBuilder
│   ├── SmartObjectPlacer
│   ├── LayerFitter
│   └── SaveService
│
└── DiagnosticService
    └── diagnostics.zip
```

界面只有一个 UXP 插件，不需要浏览器插件、网页或后台。

## 2. 技术栈

建议：

- TypeScript，`strict: true`；
- React 18 + `useReducer` 管理页面状态；
- Webpack 5 打包，禁止运行时 code splitting；
- Spectrum UXP 组件或 UXP 支持的原生 HTML 控件；
- JSZip：读取 XLSX ZIP，按 entry 解压；
- fast-xml-parser：读取 OOXML；
- Vitest 或 Jest：Node 环境单元测试；
- Photoshop UXP API：DOM + `batchPlay`；
- JSON Schema：Manifest 和 Template 的持久化约束。

若 JSZip 在 196 MB 样本上未达到性能门槛，可将 ZIP 实现替换为 fflate；上层接口不得改变。

## 3. UXP Manifest

MVP 只申请本地文件权限：

```json
{
  "manifestVersion": 5,
  "host": {
    "app": "PS",
    "minVersion": "23.3.0",
    "data": { "apiVersion": 2 }
  },
  "requiredPermissions": {
    "localFileSystem": "fullAccess"
  }
}
```

不申请：

- network；
- webview；
- launchProcess；
- clipboard。

实际 manifest 仍需包含插件 ID、名称、版本、panel entrypoint 和图标。

## 4. 仓库结构

```text
/
├── AGENTS.md
├── package.json
├── manifest.json
├── webpack.config.js
├── tsconfig.json
├── src/
│   ├── index.html
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── appState.ts
│   │   └── routes.ts
│   ├── domain/
│   │   ├── models.ts
│   │   ├── errors.ts
│   │   ├── validation.ts
│   │   └── layout.ts
│   ├── infrastructure/
│   │   ├── filesystem/
│   │   │   ├── uxpFiles.ts
│   │   │   └── tempFiles.ts
│   │   └── xlsx/
│   │       ├── XlsxArchive.ts
│   │       ├── WorkbookParser.ts
│   │       ├── SharedStringsParser.ts
│   │       ├── SheetParser.ts
│   │       ├── DrawingParser.ts
│   │       ├── RelationshipResolver.ts
│   │       └── TencentSheetMapper.ts
│   ├── photoshop/
│   │   ├── modal.ts
│   │   ├── documentBuilder.ts
│   │   ├── artboardBuilder.ts
│   │   ├── smartObjectPlacer.ts
│   │   ├── layerFitter.ts
│   │   ├── saveService.ts
│   │   └── actionDescriptors.ts
│   ├── services/
│   │   ├── ImportService.ts
│   │   ├── MappingService.ts
│   │   ├── ValidationService.ts
│   │   ├── GenerationService.ts
│   │   └── ArchiveService.ts
│   ├── ui/
│   │   ├── ImportStep.tsx
│   │   ├── SheetStep.tsx
│   │   ├── ItemGrid.tsx
│   │   ├── CandidatePicker.tsx
│   │   ├── TemplateStep.tsx
│   │   ├── ValidationSummary.tsx
│   │   └── ProgressView.tsx
│   └── utils/
│       ├── a1.ts
│       ├── paths.ts
│       ├── csv.ts
│       ├── fileNames.ts
│       └── logging.ts
├── tests/
│   ├── xlsx/
│   ├── mapping/
│   ├── validation/
│   └── layout/
├── fixtures/
└── docs/
```

## 5. 核心数据模型

### 5.1 WorkbookIndex

```ts
interface WorkbookIndex {
  source: SourceFileInfo;
  sheets: SheetDescriptor[];
  sharedStringsEntry?: string;
}

interface SheetDescriptor {
  name: string;
  sheetId: string;
  relationshipId: string;
  xmlEntry: string;
  state?: "visible" | "hidden" | "veryHidden";
  order: number;
}
```

### 5.2 单元格与图片

```ts
type CellScalar = string | boolean | null;

interface CellRecord {
  address: string;
  row: number;      // 1-based
  col: number;      // 1-based
  value: CellScalar;
  rawType?: string;
}

interface ImageAnchor {
  id: string;
  anchorType: "oneCell" | "twoCell";
  fromRow: number;
  fromCol: number;
  toRow?: number;
  toCol?: number;
  relationshipId: string;
  archiveEntry: string;
  mediaType: "png" | "jpeg" | "other";
  widthEmu?: number;
  heightEmu?: number;
}
```

### 5.3 AssetCandidate

```ts
interface AssetCandidate {
  key: string;                   // `${sheet}!${codeCell}`
  assetCode: string;
  numericId?: string;
  name?: string;
  prefix: string;
  sheetName: string;
  codeCell: string;
  nameCell?: string;
  numericIdCell?: string;
  sourceGroupId: string;         // `${sheet}!row:${codeRow}`
  sourceOrder: number;
  imageCandidates: ImageCandidate[];
  selectedImageId?: string;
  issues: ValidationIssue[];
}

interface ImageCandidate {
  id: string;
  anchor: ImageAnchor;
  relativeRowOffset: number;
  relativeColOffset: number;
  thumbnailState: "notLoaded" | "loading" | "ready" | "error";
}
```

### 5.4 Template

```ts
interface PsdTemplate {
  schemaVersion: "1.0";
  id: string;
  name: string;
  artboard: {
    width: number;
    height: number;
    columns: number;
    gapX: number;
    gapY: number;
    background: "white" | "transparent";
  };
  document: {
    resolution: number;
    colorMode: "RGB";
    bitsPerChannel: 8;
  };
  placement: {
    maxVisibleWidth: number;
    maxVisibleHeight: number;
    targetCenterX: number;
    targetCenterY: number;
    allowUpscale: boolean;
    interpolation: "bicubicAutomatic" | "bicubicSharper";
  };
  layout: {
    preserveSourceGroups: boolean;
    maxArtboardsPerDocument: number;
  };
}
```

### 5.5 GenerationJob

```ts
interface GenerationJob {
  schemaVersion: "1.0";
  source: SourceFileInfo & {
    sheetName: string;
    selectedGroups?: SheetGroup[];
  };
  template: PsdTemplate;
  items: GenerationItem[];
  output: {
    folderToken?: string;
    baseName: string;
    preferPsb: boolean;
  };
}
```

## 6. XLSX 读取设计

### 6.1 原则

- XLSX 是 ZIP，不需要完整 Excel 对象模型；
- 只读取：workbook、relationships、sharedStrings、目标 sheet、目标 drawing、目标 drawing relationships 和被选图片；
- 不读取 styles、theme、calcChain；
- 所有 OOXML path 都经过统一规范化函数；
- XML namespace 不可写死前缀，只按 local name / namespace URI 解析。

### 6.2 读取步骤

#### Step A：打开归档

```ts
const entry = await localFileSystem.getFileForOpening({ types: ["xlsx"] });
const arrayBuffer = await entry.read({ format: formats.binary });
const zip = await JSZip.loadAsync(arrayBuffer);
```

具体 UXP API 参数以实际版本类型定义为准；文件必须以二进制读取。

#### Step B：工作表索引

读取：

- `xl/workbook.xml`；
- `xl/_rels/workbook.xml.rels`。

将 `<sheet r:id>` 映射为 `xl/worksheets/sheetN.xml`。

#### Step C：sharedStrings

- 若存在 `xl/sharedStrings.xml`，按索引解析；
- `<si>` 内所有 `<t>` 文本拼接；
- 保留空字符串；
- 不解析字体样式。

#### Step D：工作表单元格

支持：

- `t="s"`：shared string；
- `t="inlineStr"`：读取 `<is>`；
- 其他：读取 `<v>` 并保留字符串；
- 公式单元格优先读取已缓存 `<v>`，不执行公式。

#### Step E：drawing

从工作表 `<drawing r:id>` 找到 sheet rels，再找到 drawing XML。

解析：

- `xdr:oneCellAnchor`；
- `xdr:twoCellAnchor`；
- `xdr:from` 的 0-based row/col 转成 1-based；
- `a:blip r:embed`；
- drawing rels 的 Target；
- 图片 archive entry。

路径示例：

```text
xl/worksheets/sheet8.xml
→ xl/worksheets/_rels/sheet8.xml.rels
→ ../drawings/drawing8.xml
→ xl/drawings/_rels/drawing8.xml.rels
→ media/image2108.png
→ xl/drawings/media/image2108.png
```

必须支持 `../` 和不同 media 根目录。

### 6.3 不使用通用表格库做主解析

原因：

- 样本 `styles.xml` 已出现兼容问题；
- 业务不需要样式；
- 嵌入图片和锚点才是关键；
- 只读定向解析更省内存、更可控。

可以使用通用 ZIP/XML 库，但不能把 SheetJS/openpyxl 式完整 workbook 模型作为架构基础。

## 7. RequirementMapper 设计

### 7.1 记录发现

在所选 A 列分组覆盖的行段内遍历非空单元格：

```ts
if (assetCodeRegex.test(value.trim())) {
  createCandidate(cell);
}
```

为了避免把普通英文词当资源代码，满足以下任一条件才自动收录：

1. 命中前缀白名单；或
2. 同列上方两行存在 numericId 样式字符串；或
3. 同列下方 1–3 行存在图片锚点。

### 7.2 字段映射

优先精确偏移：

```text
numericId = codeRow - 2
name      = codeRow - 1
images    = codeRow + 1 / +2
```

找不到时：

- numericId：同列向上扫描 1–4 行，匹配 `^\d+$`；
- name：numericId 与 code 之间最近的非空文本；
- images：同列向下扫描 1–3 行；
- 若出现两个同等可信结果，生成 issue，不自动猜。

### 7.3 sourceGroup

默认：

```ts
sourceGroupId = `${sheetName}!codeRow:${codeRow}`;
```

这能复现 `02.psd` 的两个分组换行。

### 7.4 A 列分组范围

- 只接受 `startCol=endCol=1` 且纵向跨度大于 1 的 A 列合并范围；横向 merge 和普通 A 列单元格不作为分组锚点；
- 连续、规范化后同名的 A 列分段合并成一个逻辑组；
- 两个命名组之间，A 列为空但确有 AssetCandidate 的分段继承前一组，并标记 `inferredContinuation`；
- 首个命名组之前的空白资产段显示为未命名组；无资产的空模板 merge 忽略；
- 整张表没有可用 A 列纵向 merge 时，回退为单一“全部已识别项目”组；
- UI 多选一个或多个分组，不暴露 A1 输入框；
- 分组仅按 code cell 行号过滤项目；关联 name/id/image 可位于 code 行上下；
- UI 必须显示这些字段的真实来源地址。

## 8. 缩略图策略

UXP 不适合一次性显示数千张图：

- 列表分页，每页 50 项；
- 进入页面时只解压当前页图片候选；
- 图片二进制转 data URI 或临时文件 URL；
- 页面切换时释放前一页引用；
- 同一 archive entry 使用内存缓存，但设置 LRU 上限；
- 灰度或无法渲染的图片显示占位符，生成阶段仍尝试由 Photoshop 置入。

## 9. 布局算法

### 9.1 行列计算

```ts
function layoutGroups(groups, template): LayoutResult {
  let nextRow = 0;
  const placements: Placement[] = [];

  for (const group of groups) {
    for (let i = 0; i < group.items.length; i++) {
      const localRow = Math.floor(i / template.artboard.columns);
      const col = i % template.artboard.columns;
      const row = template.layout.preserveSourceGroups
        ? nextRow + localRow
        : /* compact global row */ 0;
      placements.push({ item: group.items[i], row, col });
    }
    if (template.layout.preserveSourceGroups) {
      nextRow += Math.ceil(group.items.length / template.artboard.columns);
    }
  }
}
```

紧凑模式用全局索引连续计算。

### 9.2 坐标

```ts
x = col * (artboardWidth + gapX)
y = row * (artboardHeight + gapY)
```

画板 rect：

```ts
{ left: x, top: y, right: x + width, bottom: y + height }
```

文档尺寸：

```ts
width  = columns * artboardWidth + (columns - 1) * gapX
height = rows * artboardHeight + (rows - 1) * gapY
```

默认模板与 `02.psd`：

```text
width  = 10 × 148 + 9 × 100 = 2380
height = 5 × 148 + 4 × 100 = 1140
```

## 10. Photoshop 执行设计

### 10.1 Modal 边界

所有 Photoshop 写操作放在一个 `executeAsModal` 中：

```ts
await core.executeAsModal(
  async (executionContext) => {
    // create doc, artboards, place, transform, save
  },
  { commandName: "生成棋子归档 PSD" }
);
```

每处理一个项目：

- 检查 `executionContext.isCancelled`；
- 更新进度；
- 至少出现一个 `await`，保证可取消。

### 10.2 创建文档

优先使用 DOM `app.createDocument`，设置：

- width / height；
- resolution；
- RGB；
- 8 bit；
- 透明或白色背景按模板。

若 DOM 无法设置某项，再使用 batchPlay。

### 10.3 创建画板

画板创建使用集中封装的 `batchPlay` descriptor。

开发时通过 Photoshop 的 “Record Action Commands” 记录：

1. 新建指定大小画板；
2. 设置 artboard rect；
3. 设置白色背景；
4. 命名画板。

将录制结果整理为参数化函数：

```ts
async function createArtboard(input: {
  name: string;
  rect: Rect;
  background: "white" | "transparent";
}): Promise<Layer>
```

禁止在业务代码复制 actionJSON。

### 10.4 图片临时文件

图片来自 ZIP entry，Photoshop 置入需要可访问的 UXP File：

1. 获取 plugin temporary folder；
2. 创建 `{safeAssetCode}.{ext}`；
3. 以 binary 写入；
4. 创建 session token；
5. 调用 `placeEvent`。

每项完成后可删除临时文件；为减少 I/O，也可在当前任务结束统一清理。

### 10.5 置入嵌入式智能对象

使用 batchPlay `placeEvent`，路径使用 UXP session token，默认嵌入而非 linked。

接口：

```ts
async function placeEmbeddedSmartObject(file: File): Promise<Layer>
```

置入后验证：

- active layer 存在；
- kind 为 smart object；
- 重命名为 assetCode。

### 10.6 移入画板

优先：

```ts
placedLayer.move(artboardLayer, constants.ElementPlacement.PLACEINSIDE);
```

若目标 Photoshop 版本不允许 artboard 作为 group，使用 batchPlay move descriptor。

### 10.7 缩放和定位

使用 `boundsNoEffects` 获得可见边界：

```ts
const w = bounds.right - bounds.left;
const h = bounds.bottom - bounds.top;
const shrink = Math.min(maxW / w, maxH / h, allowUpscale ? Infinity : 1);
```

若 `shrink < 1` 或允许放大：

```ts
await layer.scale(shrink * 100, shrink * 100, AnchorPosition.MIDDLECENTER);
```

重新读取 bounds 后计算中心：

```ts
currentCx = (left + right) / 2;
currentCy = (top + bottom) / 2;
targetCx  = artboardLeft + targetCenterX;
targetCy  = artboardTop  + targetCenterY;
await layer.translate(targetCx - currentCx, targetCy - currentCy);
```

默认目标中心为 (74,78)，即下移 4 px。

### 10.8 保存

用户先选择输出目录。插件在目录中创建目标 File，然后：

```ts
await document.saveAs.psd(file, { embedColorProfile: false });
```

若预估超出 PSD 约束或用户勾选 PSB：

```ts
await document.saveAs.psb(file, { embedColorProfile: false });
```

保存失败不得关闭文档，先提示用户；成功后可按设置保留或关闭。

## 11. 分卷算法

输入是有序 sourceGroup：

1. 依次加入当前卷；
2. 若加入整组会超过上限，且当前卷非空，则先结束当前卷；
3. 若单组本身超过上限，则在组内切分；
4. 每卷重新计算布局；
5. 生成结果在运行期保留原始全局顺序和卷内顺序，不额外写入伴随文件。

## 12. 校验架构

```ts
interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  itemKey?: string;
  sourceCell?: string;
  details?: Record<string, unknown>;
}
```

建议 code：

- `ASSET_CODE_MISSING`
- `ASSET_CODE_INVALID`
- `ASSET_CODE_DUPLICATE`
- `NUMERIC_ID_MISSING`
- `NUMERIC_ID_DUPLICATE`
- `IMAGE_MISSING`
- `IMAGE_SELECTION_MISSING`
- `IMAGE_DECODE_FAILED`
- `IMAGE_PLACE_FAILED`
- `UNSUPPORTED_MEDIA_TYPE`
- `SOURCE_MAPPING_AMBIGUOUS`
- `OUTPUT_NAME_COLLISION`

UI 根据 code 提供跳转或修复入口。

## 13. 状态管理

```ts
type AppPhase =
  | "idle"
  | "loadingWorkbook"
  | "selectingSheet"
  | "parsingSheet"
  | "reviewingItems"
  | "configuringTemplate"
  | "ready"
  | "generating"
  | "done"
  | "error";
```

状态中不长期保存所有图片二进制，只保存 archive entry 和缩略图缓存 key。

## 14. 日志

每条日志：

```ts
interface LogEvent {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  assetCode?: string;
  data?: Record<string, unknown>;
}
```

默认不写磁盘；用户点击“导出诊断包”时才保存。

## 15. 测试策略

### 15.1 单元测试

必须覆盖：

- A1 地址与范围判断；
- A 列合并分组、未命名分组和多组选项过滤；
- OOXML 相对路径规范化；
- workbook relationship；
- shared strings rich text；
- inline string；
- oneCellAnchor / twoCellAnchor；
- Tencent `xl/drawings/media` 路径；
- code → id/name/image 映射；
- 多候选图片；
- 分组换行布局；
- 分卷；
- 文件名清洗；
- CSV 转义；
- 校验严重级别。

### 15.2 集成测试

Node 集成测试使用小型 fixture XLSX，不依赖 Photoshop：

- 至少两个工作表；
- 一组单图片；
- 一组双图片候选；
- 一个缺 numericId；
- 一个重复 assetCode；
- 图片路径分别位于两种 media 根目录。

### 15.3 Photoshop 手工/半自动测试

Phase 0 验证：

- 新建文档；
- 创建一个画板；
- 置入一个 PNG 为嵌入式智能对象；
- 缩放定位；
- 保存 PSD。

Golden 验证使用 `fixtures/vietnam-02-golden.json`。

## 16. 性能策略

- 禁止一次性 `Promise.all` 解压数百张图片；
- 生成阶段顺序处理，最多允许小并发用于 ZIP 解压，但 Photoshop 操作必须串行；
- 解析 XML 后释放原始字符串引用；
- 缩略图缓存默认不超过 50–100 张；
- 进度拆分：读取 10%、解析 20%、提取图片 20%、Photoshop 生成 45%、保存 5%；
- 超过 100 项默认分卷；
- 若 196 MB 样本导入峰值内存不可接受，优先替换 ZIP 层，不改 Mapper 和 Photoshop 层。

## 17. 失败与恢复

### 17.1 解析失败

- 保留用户选择文件；
- 显示出错 entry 和 XML 节点；
- 允许导出诊断；
- 不进入 Photoshop modal。

### 17.2 单项置入失败

默认策略：终止当前卷，保留生成中的文档，不自动保存；显示失败 assetCode。

后续可增加“跳过失败项继续”，但 MVP 不默认启用，以避免静默漏图。

### 17.3 用户取消

- 停止后续项目；
- 不自动保存半成品；
- 询问保留或关闭当前新文档；
- 清理临时文件。

## 18. 外部技术依据

- UXP Manifest v5：<https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-guide/uxp-misc/manifest-v5/>
- executeAsModal：<https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal>
- batchPlay：<https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/batchplay>
- Document / saveAs：<https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/document>
- Layer / scale / translate / move：<https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/layer>
- UXP 文件格式：<https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/Modules/uxp/Persistent%20File%20Storage/formats/>
- Adobe 官方示例仓库：<https://github.com/AdobeDocs/uxp-photoshop-plugin-samples>
