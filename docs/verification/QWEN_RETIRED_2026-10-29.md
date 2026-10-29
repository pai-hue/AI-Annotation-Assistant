# 验证备注：千问预标注下线（2026-10-29）

## 变更摘要

- 自动预标注仅本机 YOLO；扩展 v1.4.0 主按钮「预标注」→ `ANNOTATION_YOLO` → `POST /api/annotations/yolo`
- 已移除：侧边栏「千问预标注」、阿里云发送许可勾选、`ANNOTATION_AI`、`POST /api/annotations/ai`
- 保留：模拟测试、采集示例、收录当前标注、示例库刷新/删除、类别开关
- `GET /api/ai/status` 以 YOLO 就绪为 `configured`；不再要求 DashScope Key
- `.env` 中若仍有 `DASHSCOPE_API_KEY` 可保留，预标注不再使用；勿在日志中打印密钥

## 自动化

- 扩展源码不得再出现 `btn-ai` / `ANNOTATION_AI` / `/api/annotations/ai`
- `python -m unittest server.test_yolo_service_unit -v`
- `test_ai` / `test_api`：断言 AI 路由已消失或已改测 YOLO 校验；示例库用例保留

## 未测

- Edge 端到端：真实站点 + GPU 点「预标注」写入原生框（需用户现场）
