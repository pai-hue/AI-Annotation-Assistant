# FramePilot

当前规格为 **v0.7.5（扩展 v1.5.1）**：产品范围同 0.7（**放弃千问预标注**；本机 YOLO 预标注），**文档已重排便于开发**。主线——少量人工种子 → 训练 → 侧边栏「预标注」辅助标完剩余图片（人工仍在原网站审核）。**迭代补标（原 M5.4）与现场候选训练（原 M6）由原网站完成，本插件不做**；训好的权重仍可用 M5.5 接入。模拟测试保留；**示例库已移除**（v0.7.4）。详见 [docs/spec.md](docs/spec.md)。 **M5.5 已实现**（侧边栏选权重 + 展示 `model.names`）；说明见 [docs/M5_5_YOLO_MODEL_SWITCH.md](docs/M5_5_YOLO_MODEL_SWITCH.md)。

> 同事要在自己的电脑上安装使用？见 [同事安装指南](docs/setup-colleagues.md)。注意：同事指南中若仍写千问发送，以本 README 与规格最新段落为准——预标注不再外发图片。

## M5 本机 YOLO（进行中）

规格见 [docs/spec.md](docs/spec.md) 的 M5。已完成：

- **M5.1**：`tools/prepare_yolo_dataset.py`，说明见 [docs/M5_1_YOLO_DATASET.md](docs/M5_1_YOLO_DATASET.md)
- **M5.3**：`server/yolo_service.py` + `POST /api/annotations/yolo`；侧边栏「预标注」（扩展 v1.5.1，本机 YOLO）；默认权重 `server/models/model_20261027_232748.pt`（6 类：支架/产品/手套/抱箍/黄色气枪/黄色扳手）。用法见 [docs/M5_3_YOLO_INFER.md](docs/M5_3_YOLO_INFER.md)

M5.2 首训可跳过（已有现成权重）。启动后端请用项目内 `.venv-yolo`（Python 3.12 + CUDA torch + Ultralytics）：在项目根目录执行 `.\scripts\start-server.ps1`，或 `.\.venv-yolo\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 18000`。不要用系统 Python 3.14 或未装 Ultralytics 的 `.venv`。

## 本机 YOLO 预标注（扩展 v1.5.1）

详细见 [docs/M5_3_YOLO_INFER.md](docs/M5_3_YOLO_INFER.md)。

1. 后端依赖：用项目内 `.venv-yolo` 启动（见上文 M5 / `.\scripts\start-server.ps1`）。权重路径写在根目录 `.env` 的 `YOLO_MODEL_PATH`（勿提交密钥；`DASHSCOPE_API_KEY` **预标注已不再使用**，可留在本机 `.env` 但不会被调用）。
2. 打开 `http://127.0.0.1:18000/api/ai/status`；`provider` 应为 `yolo`，`configured: true` 表示权重文件存在且本机可 import ultralytics。
3. Edge 扩展管理页重新加载扩展，确认版本为 **1.5.1**，再刷新原网站。点击工具栏 FramePilot 图标打开侧边栏。
4. 选择尚无标注的图片，确认类别开关（空心=跳过该类），点「预标注」或按 Enter。图片只在本机推理，不发阿里云。
5. 初始框写入后，在原网站审核和修正，按原网站流程保存。


## 隐私与数据安全

点「预标注」后，插件把当前图片的缩小 JPEG 副本与类别表发到**本机** `127.0.0.1:18000` 做 YOLO 推理，**不会**发送到阿里云百炼。

- 「模拟测试」不发送图片字节。
- 若 `.env` 仍留有旧的 `DASHSCOPE_API_KEY`，请勿把它发到聊天或截图；预标注路径不会读取它。

## 原网站模拟预标注

1. 保持本机 Python 服务运行。
2. 在 Edge 的 `edge://extensions/` 找到 FramePilot，点击重新加载。如果出现新站点访问提示，核对目标为 `www.threetone.com.cn`。
3. 刷新原网站 `/train/annotation/项目名/editor` 标注页。
4. 选择一张没有标注的图片，并在网站类别列表点击一个类别。模拟测试建议选刚添加的 `part`。
5. 点击浏览器工具栏的 FramePilot 图标打开侧边栏，侧边栏显示当前项目及类别状态。模拟测试与 YOLO 预标注均无需第三方发送许可。
6. 点击后会把固定比例模拟框转换为网站原生框。随后使用网站自带工具调整或删除。

模拟框使用当前选中类别，不是真实识别。插件只向本机服务发送随机请求 ID 和图片尺寸，不发送图片字节、公司项目名或类别名。写入后原网站的自动保存可能把框保存至公司后台；插件不创建数据集、不导出、不确认审核。

已有标注、播放中、原图未加载、类别变化、切图或返回数据非法时拒绝写入。原网站适配依赖当前页面脚本结构，网站更新后如提示不兼容，应重新检查。

验证：此前 14 项 Node 模拟测试和 4 项后端 HTTP 测试通过；用户已验证原网站按钮、原生框写入、移动/缩放及保存后保留。请求中切图、类别变更、播放、超时、删除及不同浏览器缩放比例仍需专项现场验收，不能把正常流程通过等同于全部验收完成。

```powershell
node --test extension/extension.test.cjs extension/platform.test.cjs extension/platform-content.test.cjs extension/sidepanel.test.cjs
```

## 启动后端

YOLO 预标注需要含 Ultralytics 的环境。推荐在项目根目录执行：

```powershell
.\scripts\start-server.ps1
```

等价于：

```powershell
.\.venv-yolo\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 18000
```

保持终端运行，按 Ctrl+C 停止。首次搭建 `.venv-yolo` 见 [docs/ai-setup.md](docs/ai-setup.md)。不要用未装 Ultralytics 的 `.venv`（Python 3.14）启动，否则侧边栏会报「未安装 Ultralytics」。

- 健康检查：http://127.0.0.1:18000/health
- 交互式接口文档：http://127.0.0.1:18000/docs

## 请求模拟标注

在另一个 PowerShell 终端执行：

```powershell
$body = @{ image_id = 'sample-1'; image_width = 1000; image_height = 800 } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:18000/api/annotations/mock' -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
```

返回框为 x=100、y=80、width=200、height=160，类别为 part_A。
这是模拟结果，尚未接入 AI；不上传图片，不保存数据，审核状态始终为 pending。

图片尺寸必须为 1～1,000,000 的整数；image_id 去除首尾空白后长度为 1～256。
缺失字段、非法类型和额外字段返回 HTTP 422。尺寸上限是接口输入保护限制，不表示已经验证超大图片的浏览器支持。

## 自动验证

```powershell
.\.venv-yolo\Scripts\python.exe -m unittest server.test_api server.test_ai server.test_yolo_service_unit -v
```

测试会在临时本地端口启动真实 HTTP 服务，并在完成后停止该测试服务。

## 测试网页

打开 http://127.0.0.1:18000/demo/ ，选择 PNG/JPEG 图片，点击“网页：生成测试框”。已有框时需先清空再生成。网页按钮用于对照测试，扩展加载方式见下方。

已在浏览器验证加载 1000×800 图片、显示框 (100, 80, 200, 160)、禁止重复生成、清空及重新生成。
服务中断、30 秒超时和请求中切换图片的防护已实现，但这些交互及窗口缩放尚未完成浏览器实测。

## 加载 Edge 扩展

1. 保持后端运行，在 Microsoft Edge 地址栏输入 `edge://extensions/`。
2. 开启“开发人员模式”，点击“加载解压缩的扩展”。
3. 选择 `D:\AI-Annotation-Assistant\extension`，不要选择项目根目录。
4. 在同一个 Edge 浏览器打开 `http://127.0.0.1:18000/demo/`。已经打开则刷新。
5. 页面应显示“扩展已连接”和“扩展：生成测试框”。选择图片，点击扩展按钮，结果应显示“扩展模拟框已生成”。

加载操作参考 [Microsoft 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。

本地演示仅支持上述 127.0.0.1 地址及 18000 端口，不支持 localhost。v0.2.0 另外支持指定 DeepData Hub 标注页。浏览器匹配规则不能限定本地端口，因此脚本会额外检查精确端口。没有申请 tabs、scripting 或所有网站权限。

扩展不会在 Codex 内置浏览器中自动出现；必须在加载了扩展的 Edge 中测试。扩展更新后，在扩展管理页点击重新加载，再刷新测试网页。

### 扩展数据流

扩展注入按钮 → 网页锁定当前图片 → content script → background service worker → 固定本机接口 → 网页校验结果并显示框。

网页与 content script 使用带版本号的 postMessage 协议，检查来源、消息类型和请求 ID；后台检查扩展来源、主框架和图片参数。页面消息不是可信的身份认证，后台不会接受页面指定的 URL 或任意请求头。真实模式还需要插件侧边栏中的人工点击和发送勾选；模型密钥只留在后端，后台只连接固定本机接口。

请求最长等待 30 秒，后台网络等待 25 秒。切换图片后旧结果被丢弃。已有框时两种生成按钮都不可用，先清空才可重新生成。

### 开发测试与验收

有 Node.js 时可运行（扩展运行本身不需要 Node.js）：

```powershell
node --test extension/extension.test.cjs
```

8 项模拟环境测试覆盖固定请求目标、来源及参数校验、失败响应、消息链路、重复生成、返回框校验、过期结果丢弃，以及人工编辑、审核门槛、空标注、YOLO 换算与拖动边界。此测试不等同于 Edge 扩展实测。

Edge 手工验收清单：

- 未加载图片时按钮禁用；加载图片后可通过扩展生成一个框。
- 生成后禁止重复点击；清空后可以再次生成。
- 停止服务后请求应显示错误；重新启动后可重试。
- 请求过程中切换图片，旧结果不会写入新图片。
- 缩放窗口后框与图片保持对齐。
- 其他网站不出现扩展按钮。

## M2：人工审核与导出

刷新测试网页即可使用，无需重新安装扩展。若有未导出的旧标注，先保存。

1. 加载图片，使用网页或扩展按钮生成模拟框；也可以直接手动画框。
2. 点击框或右侧列表选中。拖动框移动，拖动橙色角点缩放；右侧也可输入原图像素坐标并点击“应用坐标”。
3. 切换“手动画框”后在图片上拖动可补框；类别采用当前下拉选项。回到“选择 / 移动”调整已有框。
4. 选中后修改类别或删除框。新增、调整、删除、清空和修改类别均使审核状态恢复为待审核。
5. 完成整图检查后点击“确认整图审核”。没有目标的图片也可以确认并导出空标注。
6. 分别下载 JSON、YOLO 文本和类别表。导出的标注文件使用原图文件名的主体；类别表为 `classes.txt`。

演示类别为 `0: part_A`、`1: part_B`。项目类别统一配置在 `server/demo/classes.js`；导出过数据后不要改变既有 ID 的含义或顺序，新类别在末尾追加。类别表每行对应从 0 开始的类别 ID。

JSON 包含原图尺寸、类别表、审核状态、框来源及修改标记。YOLO 文本使用归一化中心点及宽高，空标注是空文本文件；不包含图片本身。页面不持久化数据，未导出时切图/离开有提醒。点击导出表示发起下载，仍需检查浏览器下载记录；本版不支持导入已导出的标注。

验证记录（2026-09-30）：

- 8 项 Node 测试、4 项后端 HTTP 测试通过。
- 在内置浏览器实际验证类别及数值修改、移动、角点缩放、手动画框、删除、审核及修改后禁用导出。
- 实际下载并读取 JSON、YOLO 和类别表。1000×800 图片的框 (150,80,200,160)，类别 1，导出 YOLO 为 `1 0.25 0.2 0.2 0.2`。
- 删除全部框后确认无目标已通过浏览器验证；空 YOLO 文本和取消拖动状态恢复通过自动测试。
- M2 与真实 Edge 扩展组合、不同浏览器缩放比例，以及请求中断/超时仍需补充现场验收。
