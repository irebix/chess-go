# 棋子go

Photoshop UXP 本地插件，用于读取腾讯文档导出的 `.xlsx`，定位表格中的资源代码与嵌入图片，并生成归档 PSD。

当前完成状态：

- Phase 0 技术尖峰已在 Windows / Photoshop 2024 真机通过；
- Phase 1 XLSX 只读解析器已完成并通过两个真实样本验证；
- Phase 2 映射、校验、分页选择和解析 Manifest 已完成代码与自动化验证，等待最终 Photoshop UI 人工复核；
- Phase 3 的核心生成、重开、精确边界、取消和 2048 空白智能对象真机验收已通过；
- Phase 4 产品化进行中，已完成界面精简、诊断包导出、大文件提示和最近文件恢复；跨平台烟测与正式打包仍待完成。

## 已完成能力

- TypeScript strict、React 18、Webpack 5 的 UXP panel；
- Photoshop 2023 24.2+ 兼容 Manifest v5（`minVersion: 24.2.0`、`apiVersion: 2`）；
- UXP 本地 `.xlsx` 二进制选择与读取；
- 直接读取 ZIP/XML，不依赖 `styles.xml` 或完整 Excel 对象模型；
- 解析 workbook、relationships、shared strings、sheet cells；
- 解析 drawing relationships、`oneCellAnchor`、`twoCellAnchor`；
- 支持腾讯 `xl/drawings/media` 与标准 `xl/media` 图片路径；
- 按工作表读取单元格与图片锚点，不预解压全部图片；
- 资源映射、缺失/重复/多图片候选校验与 A 列分组多选；
- 连续同名 A 列分段自动合并，带资源的空白分段可作为前组续段；
- 棋子链分组默认展开并可独立折叠，多排候选支持按图片排位批量选择；
- 缩略图按面板可视区域延迟加载，实时数据 URI 与 LRU 缓存均限制为 32 项；
- 独立导出包含来源地址、候选图片和校验问题的解析 Manifest；
- 导出不含 XLSX 与图片二进制的诊断 ZIP，包含摘要、解析 Manifest 和结构化日志；
- 超过 250 MB 的工作簿显示大文件模式提示；
- 通过 UXP persistent token 记住最近选择的 XLSX；令牌失效时清除记录并回退到重新选择；
- 工作簿导入后自动选择并解析第一个工作表；切换工作表时自动读取棋子链，分组默认不选；
- 范围列表工具栏显示已选数量，并提供“全选 / 清空全选”两态按钮；
- 运行日志和诊断工具默认收起；普通状态不常驻显示，仅在对应模块内显示错误并自动展开诊断；
- 主面板只显示生成画板按钮；点击后在 PSD 保存弹窗中填写名称和选择位置，只保存 PSD，后续分卷自动使用同一前缀；
- Phase 0 的新文档、148×148 画板、嵌入式智能对象、contain 定位与 PSD 保存链路；
- 每个棋子画板使用默认 RGB(199, 212, 226) 的原生画板背景，生成后可从“当前 PSD”统一拾色改色或显示/隐藏；
- 解析器、路径、A 列分组、A1 工具、布局与输出工具的自动化测试。

## 兼容范围

- Photoshop 2023（24.2）及以上；
- UXP Manifest v5，`apiVersion: 2`；
- Windows 与 macOS 代码路径均避免使用平台专属文件路径；
- 不使用网络、WebView、外部进程或剪贴板权限。

## Windows 分发安装

`release` 分支根目录包含纯 ASCII、全英文 `install.cmd`。用户可以只下载这一份 CMD：双击后安装器会自动定位或通过 winget 安装 Git，将 `release` 分支克隆/更新到 `%LOCALAPPDATA%\ChessGo\release`，随后只需选择包含 `Photoshop.exe` 的 Photoshop 根目录。安装器会请求管理员权限、开启 UXP developer mode，并将固定发布目录联接到 `Plug-ins\ChessGo`。不依赖 Creative Cloud、UXP Developer Tool、CCX 或 UPIA。若 Photoshop 正在运行，安装后需重启一次 Photoshop。

参考图持久切换依赖 Photoshop 2023 24.2 及以上版本提供的图层复合能力。

## 安装依赖与构建

需要 Node.js 20+ 和 pnpm：

```text
pnpm install
pnpm verify
```

`pnpm verify` 会依次执行 TypeScript 类型检查、单元测试和生产构建。可加载产物位于 `dist/`。

## 在 UXP Developer Tool 中加载

1. 打开 Photoshop 2023 24.2 或更高版本，并启用开发者模式。
2. 打开 Adobe UXP Developer Tool。
3. 点击 **Add Plugin**。
4. 选择 `D:\Scripts\UXP\PsdArchive\dist\manifest.json`。
5. 点击插件右侧菜单并选择 **Load**。
6. 在 Photoshop 的“增效工具 / 插件”菜单中打开“棋子go”。

修改源码后先执行 `pnpm build`，再在 UXP Developer Tool 中 Reload。

## XLSX 解析诊断

输出工作簿内所有工作表的解析摘要：

```text
pnpm inspect:xlsx "D:\path\sample.xlsx"
```

只检查一个工作表，并输出指定 assetCode 的单元格、图片 entry 与锚点：

```text
pnpm inspect:xlsx "D:\path\sample.xlsx" --sheet "越南第三十九至四十一章" --codes "ds_vietnam1,ds_vietnam3,ds_vietnam52"
```

真实样本的已记录结果见 `docs/PHASE1_PARSER_SUMMARIES.md`。

## Phase 0 真机检查结果

Windows / Photoshop 2024（25.4.0）已由用户确认测试通过，包括：

- 面板可加载；
- 新建文档和 148×148 画板；
- 图片以嵌入式智能对象置入；
- 缩放、中心位置和画板归属正确；
- 删除临时图片后 PSD 仍可正常重开；
- 原活动文档未被修改。

本次未记录耗时；macOS smoke test 仍待后续阶段完成。

## 规格与计划

- `AGENTS.md`：边界、实施顺序和禁止事项；
- `docs/01_PRD.md`：产品需求；
- `docs/02_TECHNICAL_DESIGN.md`：技术设计；
- `docs/03_ACCEPTANCE_TESTS.md`：验收用例；
- `docs/04_CODEX_EXECUTION_PLAN.md`：Phase 0–4 执行计划；
- `docs/IMPLEMENTATION_STATUS.md`：当前阶段状态；
- `docs/PHASE1_PARSER_SUMMARIES.md`：真实样本解析证据。
- `docs/PHASE2_MAPPING_SUMMARIES.md`：真实样本映射与 UI 复核状态。

真实大样本不纳入自动化测试前置条件；日常测试使用 `fixtures/` 中的小型工作簿。
