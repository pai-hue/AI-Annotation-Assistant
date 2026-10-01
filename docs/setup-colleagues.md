# 同事安装指南（每人本机一套）

适用：3～4 位同事各自在本机运行后端与扩展，每人使用自己的阿里云百炼 API Key。此方式无需改动代码，也不需要内网服务器。

## 0. 前提

- Windows 10/11。
- 已能登录原网站标注平台，并有目标标注项目的访问权限。
- 能正常访问阿里云百炼（申请密钥和调用模型用）。

## 1. 准备文件

向每位同事发送项目文件夹 `AI-Annotation-Assistant`，但**不要**包含：

- `.venv`（本机虚拟环境，路径绑定，别人机器上不能用）
- `.env`（你自己的密钥，绝不外发）
- `.git`（可选）

建议直接把文件夹压缩成 zip 后发送。解压路径尽量使用**纯英文且无空格**（例如 `D:\AI-Annotation-Assistant`），避免中文或空格路径带来的问题。

## 2. 安装 Python

安装 Python 3.11 或更新版本（3.12～3.14 均可）。安装时勾选 **“Add python.exe to PATH”**。

验证：在 PowerShell 运行 `python --version`，能显示版本号即可。

## 3. 配置自己的密钥

1. 按 [AI 配置说明](ai-setup.md) 第 1 节，在阿里云百炼**华北2（北京）**申请一个可调用 `qwen3-vl-flash` 的 API Key。
2. 在项目根目录把 `.env.example` 复制一份，改名为 `.env`（不要叫 `.env.txt`）。
3. 用记事本打开 `.env`，在 `DASHSCOPE_API_KEY=` 后填入自己的密钥并保存。

密钥只留在这台电脑，不要发到聊天、截图或 Git。

## 4. 启动后端（二选一）

### 方式一：双击 `setup.bat`

双击项目根目录的 `setup.bat`，脚本会自动创建虚拟环境、安装依赖并启动后端。**保持这个黑色窗口开启**。

### 方式二：手动命令

在项目根目录打开 PowerShell，依次执行：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload
```

启动成功后，浏览器打开 http://127.0.0.1:8000/api/ai/status ，应显示：

```json
{"provider":"qwen","model":"qwen3-vl-flash","configured":true}
```

`configured:true` 只表示读到了密钥，不验证余额、权限或网络。

## 5. 加载 Edge 扩展

1. 打开 Edge，地址栏输入 `edge://extensions/`。
2. 开启「开发人员模式」，点「加载解压缩的扩展」。
3. 选择项目里的 `extension` 文件夹（**不是**项目根目录）。
4. 确认版本为 `0.4.0`。

## 6. 使用

1. 刷新原网站标注页（`/train/annotation/项目名/editor`），暂停播放，选择一张**没有标注**的图片。
2. 页面左下角出现「AI 预标注」面板；勾选发送提示，点「预标注」或按快捷键 Enter。
3. 初始框写入后，用原网站工具人工审核、修改并按原网站流程保存。

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| `setup.bat` 提示找不到 python | 重装 Python 并勾选「Add python.exe to PATH」，再重试 |
| 状态页 `configured:false` | `.env` 里 `DASHSCOPE_API_KEY=` 后没填密钥，或文件名不是 `.env` |
| 提示密钥无效 | 确认是百炼**北京地域**的密钥，且业务空间有 `qwen3-vl-flash` 权限 |
| 面板不出现 | 扩展版本不是 0.4.0，或没刷新原网站；在扩展页点「重新加载」后刷新 |
| 图片已有标注 | 换一张空标注图片；插件不会覆盖已有标注 |
