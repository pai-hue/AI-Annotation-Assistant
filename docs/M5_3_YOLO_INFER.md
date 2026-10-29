# M5.3 本机 YOLO 推理预标注

## 现状

- 服务：`server/yolo_service.py`，接口 `POST /api/annotations/yolo`
- 状态：`GET /api/ai/status` 以 YOLO 就绪为准（`provider: "yolo"`，`configured` = 权重存在且本机有 Ultralytics）；不再把 DashScope Key 当作预标注前置条件
- 扩展 v1.5.0：侧边栏主按钮「预标注」→ `ANNOTATION_YOLO` → 上述接口；返回 `source: "yolo"`
- **千问预标注已下线**：`POST /api/annotations/ai`、侧边栏「千问预标注」与阿里云发送许可勾选均已移除
- 默认权重：`server/models/model_20261027_232748.pt`（6 类名须与站点项目类别**名称精确一致**才写入）
- `.env`：`YOLO_MODEL_PATH`、`YOLO_CONF=0.25`、`YOLO_IOU=0.45`、`YOLO_DEVICE=0`

## 启动

项目根目录，使用含 Ultralytics 的 Python（本机已验证 `D:\YoloWebAgentStarter\.venv`）：

```text
D:\YoloWebAgentStarter\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 18000
```

项目自带 `.venv` 若无 ultralytics，状态页会显示未配置。

## 使用

1. Edge 重载扩展（manifest **1.5.0**）
2. 打开原网站标注页，侧边栏应出现「预标注」（本机 YOLO）
3. 当前图无框、类别表含模型同名类时点击；框写入后用原网站工具审核保存
4. 图片不发阿里云；模拟测试保持不变；**示例库（采集/收录/刷新）已于 0.7.4 移除**

## 未在本文验收

- 真实 GPU 上对工业图端到端点侧边栏预标注（需用户现场）
- M5.2 重新训练；M5.4 迭代补标

## 相关待做

- **M5.5 已实现**：见 `docs/M5_5_YOLO_MODEL_SWITCH.md`；`.env` 仍作持久化兜底。
