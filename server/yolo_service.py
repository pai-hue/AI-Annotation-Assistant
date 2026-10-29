# -*- coding: utf-8 -*-
"""Local Ultralytics YOLO detect for FramePilot M5.3 / M5.5."""
from __future__ import annotations

import base64
import io
import math
import os
import threading
from pathlib import Path

from dotenv import dotenv_values
from PIL import Image

from server.ai_service import AIError, AIRequest, active_classes, validate_image

DEFAULT_CONF = 0.25
DEFAULT_IOU = 0.45
MAX_BOXES = 100

_model_lock = threading.Lock()
_model = None
_model_path = None
_cached_names_path = None
_cached_names = None


class YoloSettings:
    def __init__(self, model_path: str, conf: float, iou: float, device: str):
        self.model_path = model_path
        self.conf = conf
        self.iou = iou
        self.device = device


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def models_dir() -> Path:
    path = project_root() / "server" / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def get_yolo_settings() -> YoloSettings:
    root = project_root()
    values = dotenv_values(root / ".env", encoding="utf-8-sig", interpolate=False)
    path = os.environ.get("YOLO_MODEL_PATH", values.get("YOLO_MODEL_PATH") or "").strip()
    if not path:
        path = str(root / "server" / "models" / "model_20261027_232748.pt")
    model_path = Path(path)
    if not model_path.is_file():
        alt = root / path
        model_path = alt if alt.is_file() else model_path
    conf = float(os.environ.get("YOLO_CONF", values.get("YOLO_CONF") or DEFAULT_CONF))
    iou = float(os.environ.get("YOLO_IOU", values.get("YOLO_IOU") or DEFAULT_IOU))
    device = os.environ.get("YOLO_DEVICE", values.get("YOLO_DEVICE") or "0").strip() or "0"
    if not (0.0 < conf <= 1.0) or not (0.0 < iou <= 1.0):
        raise AIError("invalid_request", "YOLO_CONF / YOLO_IOU 必须在 (0, 1] 内。", 422)
    return YoloSettings(str(model_path), conf, iou, device)


def names_to_list(names) -> list[str]:
    if names is None:
        return []
    if isinstance(names, dict):
        def sort_key(key):
            try:
                return (0, int(key))
            except (TypeError, ValueError):
                return (1, str(key))

        return [str(names[key]) for key in sorted(names.keys(), key=sort_key)]
    if isinstance(names, (list, tuple)):
        return [str(item) for item in names]
    return []


def _set_names_cache(path: str | None, names: list[str] | None) -> None:
    global _cached_names_path, _cached_names
    _cached_names_path = path
    _cached_names = names


def _clear_model_cache() -> None:
    global _model, _model_path
    _model = None
    _model_path = None


def yolo_status() -> dict:
    settings = get_yolo_settings()
    ready = Path(settings.model_path).is_file()
    ultralytics_ok = False
    try:
        import ultralytics  # noqa: F401

        ultralytics_ok = True
    except Exception:
        ultralytics_ok = False
    class_names = None
    load_error = None
    if ready and ultralytics_ok:
        class_names, load_error = peek_class_names(settings.model_path)
    elif ready and not ultralytics_ok:
        load_error = "本机未安装 Ultralytics"
        _set_names_cache(None, None)
    else:
        _set_names_cache(None, None)
    return {
        "provider": "yolo",
        "configured": bool(ready and ultralytics_ok and class_names is not None),
        "model_path": settings.model_path if ready else None,
        "model_name": Path(settings.model_path).name if ready else None,
        "ultralytics": ultralytics_ok,
        "conf": settings.conf,
        "iou": settings.iou,
        "device": settings.device,
        "class_names": class_names,
        "load_error": load_error,
        "models_dir": str(models_dir()),
    }


def peek_class_names(path: str) -> tuple[list[str] | None, str | None]:
    global _cached_names_path, _cached_names
    if _cached_names_path == path and _cached_names is not None:
        return list(_cached_names), None
    try:
        model = _load_model(path)
        names = names_to_list(getattr(model, "names", None))
        if not names:
            _set_names_cache(None, None)
            return None, "权重未包含类别名（model.names）"
        _set_names_cache(path, names)
        return list(names), None
    except AIError as exc:
        _set_names_cache(None, None)
        return None, exc.message
    except Exception as exc:
        _set_names_cache(None, None)
        return None, str(exc)


def resolve_model_under_dir(rel_path: str) -> Path:
    if not isinstance(rel_path, str) or not rel_path.strip():
        raise AIError("invalid_request", "权重路径无效。", 422)
    cleaned = rel_path.replace("\\", "/").strip().lstrip("/")
    if not cleaned.lower().endswith(".pt"):
        raise AIError("invalid_request", "仅支持 .pt 权重文件。", 422)
    if ":" in cleaned.split("/")[0]:
        raise AIError("invalid_request", "仅允许选择约定目录内的相对路径。", 422)
    parts = Path(cleaned).parts
    if any(part in ("", ".", "..") for part in parts):
        raise AIError("invalid_request", "路径非法。", 422)
    base = models_dir()
    candidate = (base / cleaned).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise AIError("invalid_request", "路径超出约定模型目录。", 422) from exc
    if not candidate.is_file():
        raise AIError("not_found", f"未找到该 .pt 权重：{cleaned}", 404)
    return candidate


def list_yolo_models() -> dict:
    base = models_dir()
    items = []
    for path in sorted(base.rglob("*.pt")):
        if not path.is_file():
            continue
        try:
            resolved = path.resolve()
            rel = resolved.relative_to(base).as_posix()
        except ValueError:
            continue
        items.append(
            {
                "path": rel,
                "name": path.name,
                "size_bytes": path.stat().st_size,
            }
        )
    settings = get_yolo_settings()
    current_abs = Path(settings.model_path)
    current_rel = None
    current_name = None
    if current_abs.is_file():
        current_name = current_abs.name
        try:
            current_rel = current_abs.resolve().relative_to(base).as_posix()
        except ValueError:
            current_rel = None
    return {
        "models_dir": str(base),
        "models": items,
        "current_relative_path": current_rel,
        "current_model_name": current_name,
        "current_model_path": str(current_abs) if current_abs.is_file() else None,
    }


def _persist_env_model_path(env_value: str) -> None:
    root = project_root()
    env_path = root / ".env"
    os.environ["YOLO_MODEL_PATH"] = env_value
    line = f"YOLO_MODEL_PATH={env_value}\n"
    if not env_path.is_file():
        env_path.write_text(line, encoding="utf-8")
        return
    text = env_path.read_text(encoding="utf-8-sig")
    lines = text.splitlines(keepends=True)
    found = False
    out = []
    for raw in lines:
        stripped = raw.lstrip("\ufeff")
        if stripped.lstrip().startswith("YOLO_MODEL_PATH="):
            out.append(line)
            found = True
        else:
            out.append(raw if raw.endswith("\n") else raw + "\n")
    if not found:
        if out and not out[-1].endswith("\n"):
            out[-1] += "\n"
        out.append(line)
    env_path.write_text("".join(out), encoding="utf-8")


def switch_yolo_model(rel_path: str, confirm: bool = False) -> dict:
    if confirm is not True:
        raise AIError("invalid_request", "切换权重须明确确认（confirm=true）。", 422)
    candidate = resolve_model_under_dir(rel_path)
    old_settings = get_yolo_settings()
    old_path = old_settings.model_path
    with _model_lock:
        global _model, _model_path
        previous_model = _model
        previous_path = _model_path
        previous_names_path = _cached_names_path
        previous_names = list(_cached_names) if _cached_names is not None else None

    def restore_previous() -> None:
        with _model_lock:
            global _model, _model_path
            _model = previous_model
            _model_path = previous_path
        _set_names_cache(previous_names_path, previous_names)

    try:
        try:
            from ultralytics import YOLO
        except Exception as exc:
            raise AIError(
                "not_configured",
                "本机未安装 Ultralytics。请用已装 YOLO 的 Python 启动后端。",
                503,
            ) from exc
        new_model = YOLO(str(candidate))
        task = getattr(new_model, "task", None)
        if task and str(task) != "detect":
            raise AIError("invalid_request", f"仅支持 detect 权重，当前为 {task}。", 422)
        names = names_to_list(getattr(new_model, "names", None))
        if not names:
            raise AIError("invalid_model_result", "权重未包含类别名（model.names）。", 422)
        env_value = f"server/models/{candidate.relative_to(models_dir()).as_posix()}"
        _persist_env_model_path(env_value)
        with _model_lock:
            _model = new_model
            _model_path = str(candidate)
        _set_names_cache(str(candidate), names)
        return {
            "ok": True,
            "model_path": str(candidate),
            "model_name": candidate.name,
            "relative_path": candidate.relative_to(models_dir()).as_posix(),
            "class_names": names,
            "configured": True,
            "previous_model_path": old_path,
        }
    except AIError:
        restore_previous()
        raise
    except Exception as exc:
        restore_previous()
        raise AIError("provider_error", f"加载权重失败，已保留原权重：{exc}", 502) from exc


def _load_model(path: str):
    global _model, _model_path
    with _model_lock:
        if _model is not None and _model_path == path:
            return _model
        try:
            from ultralytics import YOLO
        except Exception as exc:
            raise AIError(
                "not_configured",
                "本机未安装 Ultralytics。请用已装 YOLO 的 Python 启动后端（例如 YoloWebAgentStarter\\.venv）。",
                503,
            ) from exc
        if not Path(path).is_file():
            raise AIError("not_configured", f"找不到 YOLO 权重：{path}", 503)
        _model = YOLO(path)
        _model_path = path
        return _model


def _decode_image(data_url: str):
    _header, data = data_url.split(",", 1)
    raw = base64.b64decode(data, validate=True)
    image = Image.open(io.BytesIO(raw))
    image.load()
    return image.convert("RGB")


def _name_map(request: AIRequest):
    mapping = {}
    for item in active_classes(request):
        if item.name not in mapping:
            mapping[item.name] = item
    return mapping


def run_yolo(request: AIRequest, settings: YoloSettings | None = None) -> dict:
    settings = settings or get_yolo_settings()
    validate_image(request)
    model = _load_model(settings.model_path)
    image = _decode_image(request.image_data_url)
    if image.size != (request.input_width, request.input_height):
        raise AIError("invalid_image", "图片尺寸与请求声明不一致。", 422)
    try:
        results = model.predict(
            source=image,
            conf=settings.conf,
            iou=settings.iou,
            device=settings.device,
            verbose=False,
        )
    except Exception as exc:
        raise AIError("provider_error", f"YOLO 推理失败：{exc}", 502) from exc
    if not results:
        raise AIError("invalid_model_result", "YOLO 未返回结果，本次未写入。")
    result = results[0]
    names = getattr(result, "names", None) or getattr(model, "names", {}) or {}
    mapping = _name_map(request)
    scale_x = request.image_width / request.input_width
    scale_y = request.image_height / request.input_height
    boxes_out = []
    skipped = 0
    boxes = getattr(result, "boxes", None)
    if boxes is not None and len(boxes):
        xyxy = boxes.xyxy.cpu().tolist()
        cls_ids = boxes.cls.cpu().tolist()
        for index, (coords, cls_raw) in enumerate(zip(xyxy, cls_ids)):
            if len(boxes_out) >= MAX_BOXES:
                break
            model_id = int(cls_raw)
            model_name = names.get(model_id, str(model_id)) if isinstance(names, dict) else str(model_id)
            site = mapping.get(model_name)
            if site is None:
                skipped += 1
                continue
            x1, y1, x2, y2 = coords
            x = max(0.0, min(float(x1) * scale_x, float(request.image_width)))
            y = max(0.0, min(float(y1) * scale_y, float(request.image_height)))
            right = max(0.0, min(float(x2) * scale_x, float(request.image_width)))
            bottom = max(0.0, min(float(y2) * scale_y, float(request.image_height)))
            width = right - x
            height = bottom - y
            if not (math.isfinite(x) and math.isfinite(y) and width > 0 and height > 0):
                skipped += 1
                continue
            boxes_out.append(
                dict(
                    id=f"yolo-{index + 1}",
                    class_id=site.id,
                    class_name=site.name,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                )
            )
    return dict(
        schema_version="1.0",
        image_id=request.image_id,
        image_width=request.image_width,
        image_height=request.image_height,
        source="yolo",
        model=Path(settings.model_path).name,
        objects=boxes_out,
        skipped_unmapped=skipped,
    )
