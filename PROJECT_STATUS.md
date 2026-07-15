# 棋子go｜项目状态与会话交接

更新时间：2026-07-15  
当前发布版本：`0.2.7`

## 一句话摘要

“棋子go”是一个 Photoshop 2023 24.2+ 的本地 UXP 面板：读取腾讯文档导出的 `.xlsx`，按 A 列棋子链分组和图片候选生成归档 PSD，并提供参考图、分组框与原生画板底板的批量控制。

## 仓库与发布

| 用途 | 本地路径 | 分支 | 当前基线 |
| --- | --- | --- | --- |
| 源码、测试、文档 | `D:\Scripts\UXP\PsdArchive` | `main` | `0.2.7`（以 `git log -1` 为准） |
| 同事安装用运行包 | `D:\Scripts\UXP\ChessGo-Release` | `release` | `0.2.7`（以 `git log -1` 为准） |

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
- 运行日志和诊断默认收起；可以导出不包含 XLSX 与图片二进制的诊断 ZIP。

## 主要代码入口

- 面板与交互：`src/app/App.tsx`
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

## 验证状态

- 最近一次 `pnpm verify`：通过。
- TypeScript strict：通过。
- Vitest：`20` 个测试文件、`77/77` 测试通过。
- Webpack production build：通过；仅有既有的 `main.js` 体积建议警告（约 371 KiB），不是构建失败。
- `dist` 与发布仓库运行文件哈希一致。
- `main` 与 `release` 在整理本文档前均为干净工作区并与远端一致。

## 仍需人工验证

- 在 Photoshop 中确认 `0.2.7` 首次显示 `智能对象边长 1024`、`画板间距 50`。
- 修改两个值、关闭并重新打开插件或重启 Photoshop，确认恢复上次合法输入。
- 用非 1024 边长生成 PSD，双击空白智能对象，确认内部 PSB 尺寸正确、编辑保存可回写，画板内外观仍为 `148×148 px`。
- 选择包含无关联图片提醒的棋子，确认仍生成画板和空白智能对象，且该画板没有参考图图层。
- 在同事机器运行 `release/install.cmd`，确认首次安装、同版本快速安装和网络受限时的 Codeload 回退。

## 新会话开始方式

1. 告诉 Codex 工作目录为 `D:\Scripts\UXP\PsdArchive`。
2. 要求先读 `AGENTS.md` 和 `PROJECT_STATUS.md`。
3. 说明本次要改的 UI 或 Photoshop 行为，并提供截图/诊断 ZIP（如有）。
4. 修改后要求运行 `pnpm verify`；准备给同事更新时再同步并推送 `release`。
