# -*- coding: utf-8 -*-
"""YOLO service unit tests: mocked model, no GPU / no Ultralytics required for mapping cases."""
from __future__ import annotations

import base64
import os
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.ai_service import AIError, AIRequest, ProjectClass
from server import yolo_service as ys


def sample_png(w=100, h=80):
    buf = BytesIO()
    Image.new("RGB", (w, h), (200, 100, 50)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def make_request(**kwargs):
    data = dict(
        image_id="img1",
        image_width=100,
        image_height=80,
        input_width=100,
        input_height=80,
        image_data_url=sample_png(),
        classes=[ProjectClass(id=7, name="支架"), ProjectClass(id=8, name="产品")],
        project_id="p1",
        enabled_class_ids=[7, 8],
    )
    data.update(kwargs)
    return AIRequest(**data)


class YoloServiceTests(unittest.TestCase):
    def tearDown(self):
        ys._clear_model_cache()
        ys._set_names_cache(None, None)
        for key in ("YOLO_MODEL_PATH", "YOLO_CONF", "YOLO_IOU", "YOLO_DEVICE"):
            os.environ.pop(key, None)

    def test_status_without_ultralytics(self):
        with tempfile.TemporaryDirectory() as td:
            pt = Path(td) / "fake.pt"
            pt.write_bytes(b"x")
            env = {
                "YOLO_MODEL_PATH": str(pt),
                "YOLO_CONF": "0.3",
                "YOLO_IOU": "0.5",
                "YOLO_DEVICE": "cpu",
            }
            real_import = __import__

            def fake_import(name, *a, **k):
                if name == "ultralytics" or name.startswith("ultralytics."):
                    raise ImportError("no ultra")
                return real_import(name, *a, **k)

            with patch.dict(os.environ, env, clear=False), patch("builtins.__import__", fake_import):
                st = ys.yolo_status()
            self.assertEqual(st["provider"], "yolo")
            self.assertFalse(st["configured"])
            self.assertFalse(st["ultralytics"])
            self.assertEqual(st["conf"], 0.3)
            self.assertEqual(Path(st["model_path"]).name, "fake.pt")
            self.assertIsNone(st["class_names"])

    def test_run_yolo_maps_names_and_skips_unknown(self):
        with tempfile.TemporaryDirectory() as td:
            pt = Path(td) / "fake.pt"
            pt.write_bytes(b"x")
            boxes = MagicMock()
            boxes.__len__ = lambda self: 2
            boxes.xyxy.cpu.return_value.tolist.return_value = [
                [10.0, 20.0, 40.0, 60.0],
                [1.0, 2.0, 5.0, 8.0],
            ]
            boxes.cls.cpu.return_value.tolist.return_value = [0.0, 1.0]
            result = MagicMock()
            result.boxes = boxes
            result.names = {0: "支架", 1: "未知类"}
            model = MagicMock()
            model.predict.return_value = [result]
            model.names = result.names
            env = {"YOLO_MODEL_PATH": str(pt), "YOLO_DEVICE": "cpu"}
            with patch.dict(os.environ, env, clear=False), patch.object(ys, "_load_model", return_value=model):
                out = ys.run_yolo(make_request(), ys.get_yolo_settings())
            self.assertEqual(out["source"], "yolo")
            self.assertEqual(out["schema_version"], "1.0")
            self.assertEqual(out["image_id"], "img1")
            self.assertEqual(out["skipped_unmapped"], 1)
            self.assertEqual(len(out["objects"]), 1)
            b = out["objects"][0]
            self.assertEqual(b["class_id"], 7)
            self.assertEqual(b["class_name"], "支架")
            self.assertEqual(b["x"], 10)
            self.assertEqual(b["y"], 20)
            self.assertEqual(b["width"], 30)
            self.assertEqual(b["height"], 40)

    def test_run_yolo_missing_weight(self):
        with tempfile.TemporaryDirectory() as td:
            env = {"YOLO_MODEL_PATH": str(Path(td) / "missing.pt"), "YOLO_DEVICE": "cpu"}
            with patch.dict(os.environ, env, clear=False):
                with self.assertRaises(AIError) as ctx:
                    ys.run_yolo(make_request(), ys.get_yolo_settings())
            self.assertEqual(ctx.exception.code, "not_configured")

    def test_names_to_list_ordered(self):
        self.assertEqual(ys.names_to_list({1: "b", 0: "a"}), ["a", "b"])
        self.assertEqual(ys.names_to_list(["x", "y"]), ["x", "y"])

    def test_resolve_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "models"
            base.mkdir()
            outside = Path(td) / "evil.pt"
            outside.write_bytes(b"x")
            with patch.object(ys, "models_dir", return_value=base.resolve()):
                with self.assertRaises(AIError) as ctx:
                    ys.resolve_model_under_dir("../evil.pt")
            self.assertEqual(ctx.exception.code, "invalid_request")
            with patch.object(ys, "models_dir", return_value=base.resolve()):
                with self.assertRaises(AIError):
                    ys.resolve_model_under_dir("..\\evil.pt")
            with patch.object(ys, "models_dir", return_value=base.resolve()):
                with self.assertRaises(AIError):
                    ys.resolve_model_under_dir("C:/Windows/evil.pt")

    def test_list_yolo_models_only_under_dir(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "models"
            sub = base / "sub"
            sub.mkdir(parents=True)
            (base / "a.pt").write_bytes(b"aa")
            (sub / "b.pt").write_bytes(b"bbb")
            (base / "note.txt").write_text("no")
            env = {"YOLO_MODEL_PATH": str(base / "a.pt")}
            with patch.object(ys, "models_dir", return_value=base.resolve()), patch.dict(os.environ, env, clear=False):
                out = ys.list_yolo_models()
            paths = {item["path"] for item in out["models"]}
            self.assertEqual(paths, {"a.pt", "sub/b.pt"})
            self.assertEqual(out["current_relative_path"], "a.pt")

    def test_switch_requires_confirm(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "models"
            base.mkdir()
            (base / "a.pt").write_bytes(b"x")
            with patch.object(ys, "models_dir", return_value=base.resolve()):
                with self.assertRaises(AIError) as ctx:
                    ys.switch_yolo_model("a.pt", confirm=False)
            self.assertEqual(ctx.exception.code, "invalid_request")

    def test_switch_failure_keeps_old_path(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            base = root / "server" / "models"
            base.mkdir(parents=True)
            old_pt = base / "old.pt"
            new_pt = base / "new.pt"
            old_pt.write_bytes(b"old")
            new_pt.write_bytes(b"new")
            env_file = root / ".env"
            env_file.write_text("YOLO_MODEL_PATH=server/models/old.pt\n", encoding="utf-8")
            os.environ["YOLO_MODEL_PATH"] = "server/models/old.pt"
            ys._model = MagicMock(name="old-model")
            ys._model_path = str(old_pt)
            ys._set_names_cache(str(old_pt), ["旧类"])

            class Boom:
                def __init__(self, *_a, **_k):
                    raise RuntimeError("bad weight")

            with patch.object(ys, "project_root", return_value=root), patch.object(
                ys, "models_dir", return_value=base.resolve()
            ), patch.dict("sys.modules", {"ultralytics": MagicMock(YOLO=Boom)}):
                # Ensure import ultralytics works and YOLO raises
                fake_ultra = MagicMock()
                fake_ultra.YOLO = Boom
                with patch.dict("sys.modules", {"ultralytics": fake_ultra}):
                    with self.assertRaises(AIError) as ctx:
                        ys.switch_yolo_model("new.pt", confirm=True)
            self.assertEqual(ctx.exception.code, "provider_error")
            self.assertEqual(ys._model_path, str(old_pt))
            self.assertEqual(ys._cached_names, ["旧类"])
            self.assertEqual(os.environ.get("YOLO_MODEL_PATH"), "server/models/old.pt")
            self.assertIn("old.pt", env_file.read_text(encoding="utf-8"))

    def test_switch_success_persists_and_returns_names(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            base = root / "server" / "models"
            base.mkdir(parents=True)
            old_pt = base / "old.pt"
            new_pt = base / "new.pt"
            old_pt.write_bytes(b"old")
            new_pt.write_bytes(b"new")
            env_file = root / ".env"
            env_file.write_text("YOLO_MODEL_PATH=server/models/old.pt\nYOLO_CONF=0.25\n", encoding="utf-8")
            os.environ["YOLO_MODEL_PATH"] = "server/models/old.pt"
            ys._model = MagicMock(name="old-model")
            ys._model_path = str(old_pt)
            ys._set_names_cache(str(old_pt), ["旧类"])

            fake_model = MagicMock()
            fake_model.task = "detect"
            fake_model.names = {0: "支架", 1: "产品"}

            fake_ultra = MagicMock()
            fake_ultra.YOLO = MagicMock(return_value=fake_model)
            with patch.object(ys, "project_root", return_value=root), patch.object(
                ys, "models_dir", return_value=base.resolve()
            ), patch.dict("sys.modules", {"ultralytics": fake_ultra}):
                out = ys.switch_yolo_model("new.pt", confirm=True)
            self.assertTrue(out["ok"])
            self.assertEqual(out["class_names"], ["支架", "产品"])
            self.assertEqual(out["relative_path"], "new.pt")
            self.assertEqual(os.environ["YOLO_MODEL_PATH"], "server/models/new.pt")
            self.assertIn("YOLO_MODEL_PATH=server/models/new.pt", env_file.read_text(encoding="utf-8"))
            self.assertEqual(ys._model_path, str(new_pt.resolve()))
            self.assertEqual(ys._cached_names, ["支架", "产品"])


if __name__ == "__main__":
    unittest.main()
