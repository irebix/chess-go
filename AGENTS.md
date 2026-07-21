# AGENTS.md — 棋子go

本文件是后续 Codex 会话在本仓库工作的首要说明。开始修改前，先完整阅读本文件和 `PROJECT_STATUS.md`，再检查两个仓库的工作区状态。

## 运行与编码规范

- Windows 命令统一使用 PowerShell 7（`pwsh.exe`），不要使用 Windows PowerShell（`powershell.exe`）。
- 每个 PowerShell 7 会话执行其他命令前先运行：`. "$env:USERPROFILE\.codex\pwsh-utf8.ps1"`。
- 文本默认使用 UTF-8；读取文本时显式使用 `Get-Content -Encoding utf8`，新文件默认 UTF-8 无 BOM。
- 调用 `.ps1` 脚本时使用：
  `pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command '. "$env:USERPROFILE\.codex\pwsh-utf8.ps1"; & "<script.ps1>"'`
- 每轮用户消息后的第一项操作是将 Codex Companion 桌宠切到 `thinking`；修改或验证时切到 `coding`；等待用户时切到 `waiting`；最终回复前切到 `done`；失败或阻塞时切到 `error`。
- 桌宠脚本：`$env:USERPROFILE\.codex-companion-pet\codex-pet.ps1`。状态同步失败不得中断主任务。
- 文件修改使用 `apply_patch`，不要用临时 shell 拼接覆盖源码。
- 不要覆盖用户未提交的改动；发现脏工作区时先确认改动归属并绕开无关内容。
- 除非用户明确要求，不启用子 Agent。

## 两个仓库

- 源码仓库：`D:\Scripts\UXP\PsdArchive`，分支 `main`。
- 发布仓库：`D:\Scripts\UXP\ChessGo-Release`，分支 `release`。
- 远端：`https://github.com/irebix/chess-go.git`，公开仓库。
- 源码、测试、文档只进入 `main`；同事安装所需的运行文件和英文 `install.cmd` 才进入 `release`。
- 不要让发布仓库包含 `docs`、测试、fixture、TypeScript 源码或开发依赖。
- 不要直接手改 `dist` 或发布仓库中的构建文件；先修改源码、构建，再运行发布同步脚本。

## 已确定的产品规则

- 插件名称为“棋子go”，插件 ID 为 `com.linkdesks.chess-archive-psd-generator`。
- 支持 Photoshop 2023 24.2 及以上，Manifest v5、UXP API v2。
- 输入是腾讯文档导出的本地 `.xlsx`；插件直接读取 ZIP/XML，不解析 `styles.xml`，不接腾讯文档链接、OAuth 或云服务。
- 工作簿导入后自动选择并解析第一个工作表；切换工作表后自动重新读取棋子链。
- 范围按最左侧 A 列连续分组选择，组内右侧所有行纳入；默认不全选。
- 缺少名称、非标准 `assetCode` 或无关联图片都只保留提醒，不阻断生成；输出时允许空名称。无关联图片的项目仍生成画板与空白智能对象，只是不放参考图。
- 多图片候选在同一棋子组内全部展开；支持按图片排位批量选择，某一排缺图时不强行匹配。
- 主流程只输出 PSD，不额外生成 Manifest 或 CSV。保存名称与路径由 Photoshop 保存弹窗输入；后续分卷不得静默覆盖同名文件。
- 每个棋子画板包含参考图和一个嵌入式空白智能对象。空白智能对象源画布为可配置正方形，默认边长 `1024 px`，置入画板后保持 `148×148 px`，可双击编辑并正常保存回写。
- 画板间距默认 `50 px`。智能对象边长和画板间距会用 UXP `localStorage` 记住最近一次合法输入。
- 参考图显示状态通过图层复合持久保存；切换参考图时必须保持分组框原来的显示状态。
- 分组框使用位于图层底部的分组画板；画板背景使用 Photoshop 原生画板背景，不新增有色图层。
- 当前 PSD 支持隐藏/恢复参考图、显示/隐藏分组框、修改底板颜色、隐藏/恢复底板。
- 分组画板元数据保存在一个默认折叠的隐藏文本数据组中；不为旧版 PSD 做兼容迁移。

## Photoshop 实现约束

- 所有 Photoshop 写操作必须在 `executeAsModal` 中执行。
- 优先使用 Photoshop DOM；只有 DOM 不支持的能力才使用集中封装的 `batchPlay` 描述符。
- 生成新 PSD 时不得修改用户原有文档；失败输出要清理，完整生成的前序分卷可以保留并明确提示。
- 长任务需要报告进度、响应取消并定期让出事件循环。
- 图片按需读取和解码，不能一次性解压整个工作簿的所有图片。
- TypeScript 保持 strict；解析、映射、布局、设置持久化等可独立逻辑要有单元测试。

## 修改与发布流程

1. 阅读 `PROJECT_STATUS.md`，执行 `git status -sb` 检查源码仓库和发布仓库。
2. 桌宠切换到 `coding`，使用 `apply_patch` 修改源码与测试。
3. 使用项目绑定的 Node/pnpm；如果当前 PATH 找不到运行时，追加：
   `C:\Users\linkdesks\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` 和 `...\dependencies\bin\fallback`。
4. 在源码仓库运行 `pnpm verify`。必须通过 TypeScript、Vitest 和生产构建；Webpack 仅有当前 bundle-size 警告时可接受。
5. 功能发布时同时提升 `manifest.json` 与 `package.json` 版本。
6. 同步发布文件：
   `pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command '. "$env:USERPROFILE\.codex\pwsh-utf8.ps1"; & "D:\Scripts\UXP\PsdArchive\scripts\publish-release.ps1" -SkipBuild'`
7. 校验 `dist` 与发布仓库的 `manifest.json`、`Holopix.json`、`GptImage2.json`、`ImageEditor.json`、`index.html`、`main.js`、`main.js.LICENSE.txt`、`styles.css` 哈希一致，两个仓库均通过 `git diff --check`。
8. 分别提交并推送 `main` 与 `release`。GitHub Smart HTTP 偶尔会发生 443 超时；不要无限重试。API 通道正常时可作为发布回退，但完成后必须让本地 `release`、`origin/release` 与远端提交重新一致。
9. 自动化验证由 Agent 完成；Photoshop 真机交互验收由用户执行，最终回复中明确区分两者。

## 交接要求

- 每次完成一组正式改动后更新 `PROJECT_STATUS.md` 的版本、最近改动、自动化验证和待人工验证项。
- 最终回复说明：实现结果、版本、测试数量、两个分支是否已推送、需要用户在 Photoshop 中重点验证什么。
