# Codex 执行计划

## 总原则

先消除最高风险，不从完整 UI 开始。每个 Phase 都要能独立运行、测试和提交。

## Phase 0 — 技术尖峰

### 目标

证明两条最难链路：

1. UXP 能从 `.xlsx` 读取一个指定 ZIP entry 图片；
2. UXP 能创建画板、嵌入置入图片、缩放定位并保存 PSD。

### 任务

- 初始化 TypeScript + Webpack + UXP panel；
- 文件选择器读取 xlsx binary；
- JSZip 列出 entry；
- 先用 `fixtures/tencent-export-minimal.xlsx`，临时硬编码提取 `xl/drawings/media/image1.png`；
- 若 `fixtures/private/M图标月度安排2.xlsx` 已提供，再补一次真实样本 entry 验证；
- 写到 plugin temp folder；
- 创建 148×148 画板；
- placeEvent 嵌入置入；
- 居中；
- 保存单画板 PSD；
- 记录真实 actionJSON；
- 写 `docs/IMPLEMENTATION_STATUS.md`。

### 退出条件

- 目标电脑上能生成可重新打开的 PSD；
- 智能对象是 embedded；
- 临时文件删除后 PSD 仍显示；
- 失败有日志。

## Phase 1 — XLSX 只读解析器

### 任务

- XlsxArchive 接口；
- workbook / rels；
- sharedStrings；
- sheet cells；
- drawing / rels；
- oneCellAnchor / twoCellAnchor；
- path normalize；
- 单元测试 fixture；
- 对两个真实样本输出 parser summary。

### 退出条件

- 越南工作表能定位 `ds_vietnam1/3/52`；
- 图片 entry 与当前样本一致；
- 不读取 styles.xml；
- 所有 parser tests 通过。

## Phase 2 — Manifest、映射、校验与选择

### 任务

- AssetCandidate 数据模型；
- code 发现与行偏移扫描；
- sourceGroup；
- A 列合并分组识别与多选范围；
- 校验系统；
- 分页列表；
- 多图片选择；
- 过滤和排序；
- 导出解析 Manifest。

### 退出条件

- 两个真实样本可在 UI 中浏览；
- 多候选不被自动猜；
- 重复 code 阻断；
- 当前页缩略图按需加载。

## Phase 3 — 批量 PSD 生成

### 任务

- 布局；
- 分组换行；
- 分卷；
- DocumentBuilder；
- ArtboardBuilder；
- SmartObjectPlacer；
- LayerFitter；
- 进度与取消；
- PSD/PSB 保存；
- Manifest / CSV。

### 退出条件

- Golden 43 项通过；
- 每画板一个智能对象；
- 取消有效；
- 原文档不被修改。

## Phase 4 — 产品化

### 任务

- 完整步骤式 UI；
- 模板保存；
- 最近文件 token；
- 错误提示与跳转；
- 诊断包；
- 大文件性能优化；
- Windows/macOS smoke test；
- 打包 `.ccx`；
- 用户使用说明。

### 退出条件

- PRD Definition of Done 全部满足；
- 完整验收报告；
- 无 network 权限；
- 安装包可在非开发模式安装。

## Codex 首轮提示词

```text
请先阅读 AGENTS.md、docs/01_PRD.md、docs/02_TECHNICAL_DESIGN.md、
docs/03_ACCEPTANCE_TESTS.md 和 docs/04_CODEX_EXECUTION_PLAN.md。

只执行 Phase 0，不要提前实现完整解析器或 UI。
创建可加载的 Photoshop UXP TypeScript 项目，完成：
1. 选择本地 xlsx；
2. 用 JSZip 从 `fixtures/tencent-export-minimal.xlsx` 提取硬编码 entry `xl/drawings/media/image1.png`；
3. 写入 UXP 临时目录；
4. 在新文档中创建 148×148 画板；
5. 作为嵌入式智能对象置入；
6. 缩放/居中；
7. 保存 PSD；
8. 添加最小日志和 README；
9. 更新 docs/IMPLEMENTATION_STATUS.md。

所有 Photoshop 写操作使用 executeAsModal。不要申请网络权限。
完成后列出需要在 Photoshop 中人工验证的步骤，不要声称未实测的功能已通过。
```
