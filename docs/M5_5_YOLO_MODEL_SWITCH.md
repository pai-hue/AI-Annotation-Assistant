# M5.5 侧边栏接入/切换本机 YOLO 权重

## 范围（规格 0.7.3）

1. 侧边栏展示当前生效权重与就绪状态（`GET /api/ai/status` → `yolo`）。
2. 从本机约定目录 `server/models/`（可含子目录）列出 `.pt`，用户选择后切换。
3. 切换须确认；成功后后续预标注用新权重；失败保留旧权重并提示。
4. 持久化：更新进程内模型缓存与项目 `.env` 的 `YOLO_MODEL_PATH`；扩展不存二进制、不上传云端。
5. 类别名仍须与网站项目类别**精确一致**才写入；不自动改网站类别表。
6. 加载后读 `model.names` 并在侧边栏展示；可与当前项目类别比对标匹配/未匹配；加载失败不展示过期标签。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai/status` | `yolo.model_path` / `model_name` / `configured` / `class_names` / `load_error` |
| GET | `/api/yolo/models` | 列出 `server/models/**/*.pt`；含当前相对路径 |
| POST | `/api/yolo/model` | Body：`{"path":"相对路径.pt","confirm":true}`；仅约定目录内相对路径 |

## 扩展

- 版本 **v1.5.0**：侧边栏「YOLO 权重」区块；background 中继 `PANEL_YOLO_STATUS` / `PANEL_YOLO_MODELS` / `PANEL_YOLO_SWITCH`。

## 明确不做

浏览器上传超大 `.pt`、侧边栏训练/改超参、自动下载公网权重、无确认热切换、根据模型标签自动改网站类别。

## 未现场验收

真实 Edge 侧边栏 × GPU YOLO 联调（用户操作确认切换后预标注效果）。

## 安全提示

- `.pt` 加载会反序列化，存在执行恶意代码风险；`server/models/` 只放来源可信的权重。
- 本机单用户工具按约定目录选择文件；与工业视觉平台（`model_id` 登记制）对齐待其 V03 再统一。

