# M3：配置通义千问预标注（v0.4.0）

本版本使用阿里云百炼的通义千问视觉模型，默认 `qwen3-vl-flash`。插件只生成初始框，审核、调整、保存仍在原网站；已验证的模拟链路继续可用。

## 1. 获取密钥并填写本机配置

1. 登录阿里云百炼控制台，按页面提示开通模型服务。
2. 进入 API Key 页面，地域选择**华北2（北京）**。
3. 创建 API Key，选择有权调用 `qwen3-vl-flash` 的业务空间及权限，在本机复制密钥。具体入口见[阿里云官方获取 API Key 说明](https://help.aliyun.com/zh/model-studio/get-api-key)。

当前后端固定连接北京地域；其他地域的密钥不能混用。这里需要百炼 API Key，千问聊天账号登录和原 OpenAI API Key 不能代替它。

在 VS Code 的项目根目录 `D:\AI-Annotation-Assistant` 找到 `.env`。如果没有，将 `.env.example` 复制一份并改名为 `.env`，不要叫 `.env.txt`。

```dotenv
DASHSCOPE_API_KEY=在本机填写你的百炼北京地域API密钥
QWEN_MODEL=qwen3-vl-flash
```

在 `DASHSCOPE_API_KEY=` 后填写真实密钥，保存为 UTF-8。密钥不要发到聊天、截图、扩展或 Git。`.gitignore` 已忽略 `.env`，只有空白示例文件可提交。已有同名系统环境变量优先于 `.env`。如果文件中保留了旧的 `OPENAI_API_KEY` / `OPENAI_MODEL`，新版本不会读取它们，也不会回退到 OpenAI。

默认使用非思考模式的 `qwen3-vl-flash`。需要比较效果时，可把 `QWEN_MODEL` 改为 `qwen3-vl-plus`；先确认北京地域账号有调用权限及可用额度。当前适配要求模型支持图片输入、非思考模式、JSON Object 输出和 0～1000 定位坐标，不应随意换成纯文本模型。

## 2. 启动并检查

终端当前目录应为 `D:\AI-Annotation-Assistant`：

```powershell
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload
```

如果服务已经运行并正常热更新，无需再启动第二个进程；更新依赖后如提示导入错误，在原终端 Ctrl+C，再执行启动命令。

打开 `http://127.0.0.1:8000/api/ai/status`，会返回：

```json
{"provider":"qwen","model":"qwen3-vl-flash","configured":true}
```

`configured` 仅检查是否填写密钥；留空时为 `false`，不会调用千问，也不代表密钥有效、额度充足或网络连通。后端在每次请求时读取 `.env`，修改后保存即可。如果仍显示 `provider: openai`，重启原来的本机服务使代码更新生效。

## 3. 重新加载扩展

1. 在 Edge 地址栏输入 `edge://extensions/`。
2. 找到 AI Annotation Assistant，点击重新加载，确认版本为 `0.4.0`。
3. 刷新原网站标注页。
4. 暂停播放，选择一张没有标注、允许发送给阿里云百炼的测试图片；确保项目已有合适的类别名。
5. 面板显示“千问预标注”和“模拟测试”。模拟测试保留原来的固定框功能，不发送图片。
6. 勾选“允许将当前图片及项目类别发送到阿里云百炼（通义千问，按用量计费）”，点击“千问预标注”。
7. 等待结果期间保持当前图片和类别表不变。生成成功后，在原网站使用原有工具检查和修改。

AI 使用项目类别表中的全部类别，保留原 ID；它不会把所有目标都改成当前鼠标选中的类别。当前选中类别仅决定模拟框的类别。类别名应能表达目标含义，`part` 这样的泛称可能得到较宽泛的结果。

有框的图片不会被覆盖。先用另一张空标注测试图；需要删除或修改已有框时在原网站操作。网站可能自动保存初始框到公司后台，这不等于人工审核完成。

## 4. 图片发送范围与接口

- 页面打开、切图、轮询状态和模拟测试不发送图片。每次真实请求由面板上的人工点击触发。
- 从已加载的原图缓存获取画面，不截取浏览器窗口，不使用带标注线的编辑画布。
- 图片等比例缩小到最长边不超过 1600 像素，生成 JPEG（质量 0.85、透明区域白底），编码文件最多 2 MiB。
- 扩展只向 `http://127.0.0.1:8000/api/annotations/ai` 发送随机请求 ID、原图/缩小图尺寸、图片内容和类别 ID/名称；不发送项目名、文件名、账号、Cookie 或 API Key。
- 后端只向 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` 发送图片、类别和标注提示词。该地址是北京地域的兼容接口；官方也提供业务空间专属域名，目前原地址仍支持使用。
- 扩展不直接连接外部 AI，不支持任意转发 URL 或自定义 API 地址。本机服务继续只监听 `127.0.0.1`。
- 模型使用 `enable_thinking: false`、`stream: false` 和 `response_format: {"type":"json_object"}`，通过 `choices[0].message.content` 解析结果。JSON Object 不保证字段结构，后端仍严格校验全部字段，不接受截断响应或自动修补结果。
- 模型输出 `objects`，每个框只有 `class_id/xmin/ymin/xmax/ymax` 五个整数字段；边界为 0～1000，换算公式为 `x = xmin × 原图宽 / 1000`，其他边界同理，再计算宽高。不会根据数值大小猜测单位。全部框校验通过才写入；未知类别、负宽高、超界、非数值及旧版 0～1 小数坐标均拒绝整批结果。
- 模型调用最长 22 秒，扩展请求 25 秒超时，页面 30 秒超时。没有自动重试；网络中断或超时仍可能发生提供方用量，按实际 API 账单核对。

接口字段：

```json
{
  "image_id": "随机请求ID",
  "image_width": 4000,
  "image_height": 2000,
  "input_width": 1600,
  "input_height": 800,
  "image_data_url": "data:image/jpeg;base64,图片Base64内容",
  "classes": [{"id": 0, "name": "工件主体"}, {"id": 3, "name": "电动螺丝刀"}]
}
```

本机接口返回沿用 `schema_version/image_id/image_width/image_height/objects`，`source` 为 `qwen`，附带 `model`；每个框包含 `id/class_id/class_name/x/y/width/height`，坐标均为原图像素。没有审核状态字段。空 `objects` 仅表示本次未生成框，仍需人工检查。

接口实现依据[百炼 Chat Completions 文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[JSON 输出说明](https://help.aliyun.com/zh/model-studio/qwen-structured-output)及 [Qwen3-VL 定位示例](https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/2d_grounding.ipynb)。接口虽使用兼容格式，实际调用和计费提供方是阿里云百炼。当前以生成可修改初始框为验收目标，不设独立识别准确率门槛。

## 5. 常见提示

| 提示 | 处理 |
| --- | --- |
| 尚未配置千问 API Key | 在根目录 `.env` 填写 `DASHSCOPE_API_KEY` 并保存，检查配置状态 |
| 千问 API Key 无效 | 检查是否使用百炼北京地域的密钥，以及业务空间权限 |
| 百炼拒绝访问 | 检查模型服务是否开通、模型权限及阿里云账号余额 |
| 百炼额度不足或请求过于频繁 | 查看百炼模型用量、余额或稍后重试 |
| 模型不可用 / 请求被拒绝 | 检查 `QWEN_MODEL`，先恢复默认 `qwen3-vl-flash` |
| 无法连接阿里云百炼 / 超时 | 检查本机网络及 API 可用性；已有标注不会改变 |
| 原网站限制图片读取 | 该图的 Canvas 读取受限，需要进一步适配，不会退回窗口截图 |
| 当前图片已有标注 | 在原网站选择一张空标注图片 |
| 图片或类别已变化 | 本次结果丢弃，选定目标后重新点击 |
| 模型返回格式、坐标或类别无效 | 整批结果未写入，可以重试或在原网站手动标注 |

## 6. 已验证与待验证

2026-10-01：23 项 Node 测试及 21 项 Python 测试通过，覆盖原有模拟流程、发送提示与点击条件、原图缩放、多类别 ID、千问请求格式、0～1000 坐标换算、旧 OpenAI 配置不被使用、错误/超时、图片校验、非法模型返回和不覆盖已有数据。

上述自动化测试使用本地生成图片和伪造的千问响应，不产生真实 API 调用或公司图片上传。此前用户已验证 v0.2.0 模拟框的原网站写入、编辑及保存流程。

2026-10-01 用户试用反馈：说明重新加载 v0.4.0 扩展及刷新原网站后，用户反馈“ok，目前测试没有发现任何问题”，记录为本轮试用通过。未提供样本量、耗时和逐项测试结果，异常场景专项验证与效率评估仍待开展。本次反馈记录只更新文档，没有重新运行测试或调用模型。

复测命令（均不产生真实模型 API 用量）：

```powershell
.\.venv\Scripts\python.exe -m unittest server.test_api server.test_ai -v
node --test extension/extension.test.cjs extension/platform.test.cjs extension/platform-content.test.cjs
```
