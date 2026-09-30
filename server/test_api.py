"""HTTP smoke tests using only the standard library and the installed server."""

import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        cls.process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server.main:app",
             "--host", "127.0.0.1", "--port", str(port)],
            cwd=Path(__file__).resolve().parents[1],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                raise RuntimeError("Server exited before startup")
            try:
                with urlopen(cls.base + "/health", timeout=1):
                    return
            except (URLError, TimeoutError):
                time.sleep(0.1)
        raise RuntimeError("Server startup timed out")

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)

    def post(self, payload):
        request = Request(
            self.base + "/api/annotations/mock",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_health(self):
        with urlopen(self.base + "/health", timeout=5) as response:
            self.assertEqual(json.load(response)["status"], "ok")

    def test_spec_example(self):
        result = self.post(dict(image_id="sample-1", image_width=1000, image_height=800))
        self.assertEqual(result["image_id"], "sample-1")
        self.assertEqual(result["source"], "mock")
        self.assertEqual(result["review_status"], "pending")
        self.assertEqual(result["objects"], [dict(
            id="box-1", class_id=0, class_name="part_A",
            x=100, y=80, width=200, height=160,
        )])

    def test_small_and_portrait_images(self):
        for width, height in [(1, 1), (333, 999), (1000000, 1)]:
            with self.subTest(size=(width, height)):
                result = self.post(dict(image_id="sample", image_width=width, image_height=height))
                box = result["objects"][0]
                self.assertGreater(box["width"], 0)
                self.assertGreater(box["height"], 0)
                self.assertLessEqual(box["x"] + box["width"], width)
                self.assertLessEqual(box["y"] + box["height"], height)

    def test_invalid_requests(self):
        valid = dict(image_id="sample", image_width=1000, image_height=800)
        cases = [{}, {**valid, "image_id": "  "}, {**valid, "image_id": 1},
                 {**valid, "extra": True}]
        for field in ("image_width", "image_height"):
            for value in (0, -1, 1.5, "100", True, None, 1000001):
                cases.append({**valid, field: value})
        for payload in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(HTTPError) as raised:
                    self.post(payload)
                self.assertEqual(raised.exception.code, 422)
                raised.exception.close()


if __name__ == "__main__":
    unittest.main()
