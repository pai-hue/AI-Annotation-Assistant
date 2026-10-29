# -*- coding: utf-8 -*-
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from prepare_yolo_dataset import prepare, validate_label_text


class PrepareYoloDatasetTests(unittest.TestCase):
    def test_validate_label_ok(self):
        text = validate_label_text("0 0.5 0.5 0.2 0.2\n", 2, "t")
        self.assertIn("0 0.500000", text)

    def test_validate_label_rejects_oob_class(self):
        with self.assertRaises(ValueError):
            validate_label_text("2 0.5 0.5 0.2 0.2\n", 2, "t")

    def test_prepare_from_flat_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            src.mkdir()
            (src / "classes.txt").write_text("part\ndefect\n", encoding="utf-8")
            # Minimal valid JPEG header is not required; copy as binary stub with .jpg
            for i in range(5):
                (src / f"img{i}.jpg").write_bytes(b"\xff\xd8\xfffake" + bytes([i]))
                (src / f"img{i}.txt").write_text(
                    f"0 0.5 0.5 0.1 0.1\n1 0.2 0.2 0.05 0.05\n", encoding="utf-8"
                )
            out = Path(tmp) / "datasets"
            manifest = prepare(
                source=src,
                out_root=out,
                name="demo50",
                val_ratio=0.2,
                seed=1,
                classes_file=None,
                require_labels=True,
            )
            self.assertEqual(manifest["counts"]["train"] + manifest["counts"]["val"], 5)
            self.assertTrue((out / "demo50" / "data.yaml").is_file())
            self.assertEqual(manifest["class_count"], 2)
            data = (out / "demo50" / "manifest.json").read_text(encoding="utf-8")
            self.assertIn("m5.1", data)

    def test_prepare_from_zip_nested(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            nested = base / "pack" / "export"
            nested.mkdir(parents=True)
            (nested / "classes.txt").write_text("a\n", encoding="utf-8")
            (nested / "images").mkdir()
            (nested / "labels").mkdir()
            (nested / "images" / "x.png").write_bytes(b"png")
            (nested / "labels" / "x.txt").write_text("0 0.4 0.4 0.2 0.2\n", encoding="utf-8")
            zip_path = base / "export.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                for path in nested.rglob("*"):
                    if path.is_file():
                        zf.write(path, path.relative_to(base / "pack").as_posix())
            out = base / "out"
            manifest = prepare(
                source=zip_path,
                out_root=out,
                name="zipdemo",
                val_ratio=0.0,
                seed=0,
                classes_file=None,
                require_labels=True,
            )
            self.assertEqual(manifest["counts"]["train"], 1)
            self.assertEqual(manifest["counts"]["val"], 0)
            self.assertTrue((out / "zipdemo" / "images" / "train" / "x.png").is_file())



    def test_prepare_site_export_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            (src / "imgs").mkdir(parents=True)
            (src / "labels").mkdir()
            (src / "labels.txt").write_text("手套\n气枪\n", encoding="utf-8")
            (src / "imgs" / "a.jpg").write_bytes(b"\xff\xd8\xffa")
            (src / "labels" / "a.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
            out = Path(tmp) / "out"
            manifest = prepare(
                source=src,
                out_root=out,
                name="site",
                val_ratio=0.0,
                seed=0,
                classes_file=None,
                require_labels=True,
            )
            self.assertEqual(manifest["counts"]["train"], 1)
            self.assertEqual(manifest["classes"], ["手套", "气枪"])


if __name__ == "__main__":
    unittest.main()
