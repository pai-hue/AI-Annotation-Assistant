"""AI contract tests use generated images and an in-process fake provider, never an API key."""

import asyncio
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import httpx
from PIL import Image
from pydantic import ValidationError

from server.ai_service import (
    AIError, AIRequest, MAX_BODY_BYTES, ProjectClass, ReferenceRequest,
    REFERENCES_DIR, Settings, build_payload, convert_response,
    generate_annotations, get_settings, load_references, project_key,
    save_reference, validate_image,
)
from server.main import app


def sample():
    buffer = BytesIO()
    Image.new("RGB", (100, 80), (70, 120, 90)).save(buffer, format="PNG")
    return dict(image_id="test-1", image_width=100, image_height=80, input_width=100, input_height=80,
                image_data_url="data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode(),
                classes=[dict(id=3, name="工件"), dict(id=9, name="part")])


def model_reply(objects=None, finish_reason="stop"):
    if objects is None:
        objects = [dict(class_id=9, xmin=100, ymin=250, xmax=600, ymax=750)]
    return dict(choices=[dict(index=0, finish_reason=finish_reason,
                             message=dict(role="assistant", content=json.dumps(dict(objects=objects))))])


class SettingsTests(unittest.TestCase):
    def test_old_openai_config_does_not_enable_qwen_or_reuse_key(self):
        previous = dict(OPENAI_API_KEY="old-private-key", OPENAI_MODEL="gpt-4.1-mini")
        with patch.dict(os.environ, previous, clear=True), patch("server.ai_service.dotenv_values", return_value=previous):
            settings = get_settings()
        self.assertEqual(settings.api_key, "")
        self.assertEqual(settings.model, "qwen3-vl-flash")

    def test_qwen_file_settings_and_environment_precedence(self):
        values = dict(DASHSCOPE_API_KEY=" file-key ", QWEN_MODEL=" qwen3-vl-plus ")
        with patch.dict(os.environ, {}, clear=True), patch("server.ai_service.dotenv_values", return_value=values):
            self.assertEqual(get_settings(), Settings("file-key", "qwen3-vl-plus"))
            with patch.dict(os.environ, {"DASHSCOPE_API_KEY": "env-key", "QWEN_MODEL": "qwen3-vl-flash"}):
                self.assertEqual(get_settings(), Settings("env-key", "qwen3-vl-flash"))
            with patch.dict(os.environ, {"DASHSCOPE_API_KEY": "", "QWEN_MODEL": " "}):
                self.assertEqual(get_settings(), Settings("", "qwen3-vl-flash"))


class ModelTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._refs = patch("server.ai_service.REFERENCES_DIR", Path(self._tmp.name))
        self._refs.start()
        self.addCleanup(self._refs.stop)

    async def test_real_wire_contract_and_original_pixels(self):
        captured = []

        def provider(request):
            captured.append(request)
            return httpx.Response(200, json=model_reply())

        request = AIRequest(**sample())
        result = await generate_annotations(request, Settings("fake-test-key"), transport=httpx.MockTransport(provider))
        self.assertEqual(len(captured), 1)
        wire = json.loads(captured[0].content)
        self.assertEqual(str(captured[0].url), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
        self.assertEqual(captured[0].headers["Authorization"], "Bearer fake-test-key")
        self.assertEqual(wire["model"], "qwen3-vl-flash")
        self.assertFalse(wire["stream"])
        self.assertFalse(wire["enable_thinking"])
        self.assertNotIn(request.image_id, captured[0].content.decode())
        self.assertEqual(wire["response_format"], {"type": "json_object"})
        self.assertEqual(wire["messages"][1]["content"][0],
                         {"type": "image_url", "image_url": {"url": request.image_data_url}})
        self.assertIn('"id": 3', wire["messages"][1]["content"][1]["text"])
        self.assertIn("工件", wire["messages"][1]["content"][1]["text"])
        for unsupported in ("store", "input", "text", "max_output_tokens", "extra_body"):
            self.assertNotIn(unsupported, wire)
        self.assertEqual(result["objects"], [dict(id="ai-1", class_id=9, class_name="part", x=10, y=20, width=50, height=40)])
        self.assertEqual(result["source"], "qwen")
        self.assertNotIn("review_status", result)

    async def test_adjacent_same_class_instances_remain_separate(self):
        values = sample()
        values["classes"] = [dict(id=9, name="黑色板件")]
        objects = [dict(class_id=9, xmin=100, ymin=250, xmax=400, ymax=750),
                   dict(class_id=9, xmin=400, ymin=250, xmax=700, ymax=750)]
        result = await generate_annotations(
            AIRequest(**values), Settings("fake-test-key"),
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=model_reply(objects))))
        self.assertEqual(result["objects"], [
            dict(id="ai-1", class_id=9, class_name="黑色板件", x=10, y=20, width=30, height=40),
            dict(id="ai-2", class_id=9, class_name="黑色板件", x=40, y=20, width=30, height=40),
        ])

    async def test_provider_failures_are_sanitized_and_never_retried(self):
        for status, code in [(400, "provider_request"), (401, "invalid_key"), (402, "quota_or_rate_limit"), (403, "access_denied"), (404, "model_unavailable"),
                             (429, "quota_or_rate_limit"), (500, "provider_error"), (302, "provider_error")]:
            calls = []

            def provider(request):
                calls.append(request)
                return httpx.Response(status, json={"error": "secret-provider-body"})

            with self.subTest(status=status), self.assertRaises(AIError) as caught:
                await generate_annotations(AIRequest(**sample()), Settings("secret-key"), transport=httpx.MockTransport(provider))
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn("secret", str(caught.exception))
            self.assertEqual(len(calls), 1)

    async def test_total_timeout_and_network_failure(self):
        async def slow(_request):
            await asyncio.sleep(0.05)
            return httpx.Response(200, json=model_reply())

        with patch("server.ai_service.MODEL_TIMEOUT", 0.005), self.assertRaises(AIError) as caught:
            await generate_annotations(AIRequest(**sample()), Settings("fake"), transport=httpx.MockTransport(slow))
        self.assertEqual(caught.exception.code, "timeout")

        def offline(_request):
            raise httpx.ConnectError("private diagnostic")

        with self.assertRaises(AIError) as caught:
            await generate_annotations(AIRequest(**sample()), Settings("fake"), transport=httpx.MockTransport(offline))
        self.assertEqual(caught.exception.code, "network_error")
        self.assertNotIn("private", str(caught.exception))

    async def test_missing_key_cannot_call_provider(self):
        def unexpected(_request):
            self.fail("Network must not be reached")

        with self.assertRaises(AIError) as caught:
            await generate_annotations(AIRequest(**sample()), Settings(""), transport=httpx.MockTransport(unexpected))
        self.assertEqual(caught.exception.code, "not_configured")
        self.assertIn("DASHSCOPE_API_KEY", caught.exception.message)

    async def test_non_json_response_does_not_leak_provider_body(self):
        with self.assertRaises(AIError) as caught:
            await generate_annotations(AIRequest(**sample()), Settings("fake"), transport=httpx.MockTransport(
                lambda _: httpx.Response(200, text="private upstream error")))
        self.assertEqual(caught.exception.code, "invalid_model_result")
        self.assertNotIn("private", caught.exception.message)

    def _reference_request(self, class_id):
        buffer = BytesIO()
        Image.new("RGB", (320, 240), (10, 20, 30)).save(buffer, format="JPEG")
        return ReferenceRequest(classes=[ProjectClass(id=3, name="工件"), ProjectClass(id=9, name="part")],
            class_id=class_id, input_width=320, input_height=240,
            image_data_url="data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode())

    async def test_enabled_classes_filter_prompt_and_references(self):
        save_reference(self._reference_request(9))
        request = AIRequest(**{**sample(), "enabled_class_ids": [3]})
        captured = []

        def provider(req):
            captured.append(req)
            return httpx.Response(200, json=model_reply(objects=[dict(class_id=3, xmin=100, ymin=250, xmax=600, ymax=750)]))

        result = await generate_annotations(request, Settings("fake"), transport=httpx.MockTransport(provider))
        self.assertEqual(result["objects"], [dict(id="ai-1", class_id=3, class_name="工件", x=10, y=20, width=50, height=40)])
        wire = json.loads(captured[0].content)
        content = wire["messages"][1]["content"]
        self.assertEqual(content[0], {"type": "image_url", "image_url": {"url": request.image_data_url}})
        self.assertIn('"id": 3', content[-1]["text"])
        self.assertNotIn('"id": 9', content[-1]["text"])

    async def test_disabled_class_output_is_rejected(self):
        request = AIRequest(**{**sample(), "enabled_class_ids": [3]})
        with self.assertRaises(AIError) as caught:
            await generate_annotations(request, Settings("fake"), transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=model_reply())))
        self.assertEqual(caught.exception.code, "invalid_model_result")


class ValidationTests(unittest.TestCase):
    def test_invalid_model_boxes_rejected_atomically(self):
        valid = dict(class_id=3, xmin=100, ymin=200, xmax=600, ymax=800)
        for mutation in [dict(class_id=0), dict(class_id=True), dict(xmin=-1), dict(xmax=1001),
                         dict(xmin=600), dict(ymax=100), dict(xmin="100"), dict(xmin=float("nan")),
                         dict(xmax=float("inf")), dict(xmin=True), dict(extra=1)]:
            with self.subTest(mutation=mutation), self.assertRaises(AIError):
                convert_response(model_reply([valid, {**valid, **mutation}]), AIRequest(**sample()), "test")
        with self.assertRaises(AIError):
            convert_response(model_reply([valid] * 101), AIRequest(**sample()), "test")

    def test_incomplete_refusal_and_empty(self):
        request = AIRequest(**sample())
        for payload in [model_reply(finish_reason="length"), model_reply(finish_reason=None), {}, [],
                        dict(choices=[]), dict(choices=model_reply()["choices"] * 2)]:
            with self.subTest(payload=payload), self.assertRaises(AIError):
                convert_response(payload, request, "test")
        for payload in [model_reply(finish_reason="content_filter"), dict(choices=[dict(
                finish_reason="stop", message=dict(role="assistant", refusal="private reason", content=None))])]:
            with self.subTest(payload=payload), self.assertRaises(AIError) as caught:
                convert_response(payload, request, "test")
            self.assertEqual(caught.exception.code, "model_refusal")
            self.assertNotIn("private", caught.exception.message)
        result = convert_response(model_reply([]), request, "test")
        self.assertEqual(result["objects"], [])
        self.assertNotIn("review_status", result)

    def test_json_mode_still_requires_the_exact_local_schema(self):
        for content in [None, [], "", "```json\n{\"objects\":[]}\n```", "[]", '{"objects":',
                        '{"objects":[],"extra":1}', '{"objects":[{"class_id":9}]}',
                        '{"objects":[{"class_id":9,"xmin":0.1,"ymin":0.25,"xmax":0.6,"ymax":0.75}]}']:
            payload = model_reply()
            payload["choices"][0]["message"]["content"] = content
            with self.subTest(content=content), self.assertRaises(AIError) as caught:
                convert_response(payload, AIRequest(**sample()), "test")
            self.assertEqual(caught.exception.code, "invalid_model_result")

    def test_full_frame_1000_grid_converts_exactly_to_image_bounds(self):
        result = convert_response(model_reply([dict(class_id=3, xmin=0, ymin=0, xmax=1000, ymax=1000)]),
                                  AIRequest(**sample()), "qwen3-vl-flash")
        self.assertEqual(result["objects"], [dict(id="ai-1", class_id=3, class_name="工件", x=0, y=0, width=100, height=80)])

    def test_encoded_image_and_metadata_must_agree(self):
        validate_image(AIRequest(**sample()))
        for values in [dict(image_data_url="https://example.com/image.png"), dict(image_data_url="data:image/png;base64,AAAA"),
                       dict(image_data_url=sample()["image_data_url"].replace("image/png", "image/jpeg")),
                       dict(input_width=99, image_width=99)]:
            with self.subTest(values=list(values)), self.assertRaises(AIError):
                validate_image(AIRequest(**{**sample(), **values}))
        for values in [dict(classes=[dict(id=9, name="a"), dict(id=9, name="b")]), dict(classes=[]),
                       dict(classes=[dict(id=0, name="  ")]), dict(input_height=70), dict(image_width=True)]:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                AIRequest(**{**sample(), **values})

    def test_downscaled_input_maps_to_original_image(self):
        values = {**sample(), "image_width": 4000, "image_height": 2000, "input_width": 1600, "input_height": 800}
        # Only coordinate conversion here; encoded data validation is tested separately.
        result = convert_response(model_reply(), AIRequest(**values), "test")
        box = result["objects"][0]
        self.assertEqual([box[k] for k in ("x", "y", "width", "height")], [400, 500, 2000, 1000])

    def test_enabled_class_ids_must_be_a_nonempty_subset(self):
        AIRequest(**{**sample(), "enabled_class_ids": [3]})
        AIRequest(**{**sample(), "enabled_class_ids": [3, 9]})
        for values in [dict(enabled_class_ids=[]), dict(enabled_class_ids=[7]), dict(enabled_class_ids=[3, 3]),
                       dict(enabled_class_ids=[3, 9, 7]), dict(enabled_class_ids=["3"])]:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                AIRequest(**{**sample(), **values})


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.settings = patch("server.main.get_settings", return_value=Settings(""))
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.addCleanup(self.client.close)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._refs = patch("server.ai_service.REFERENCES_DIR", Path(self._tmp.name))
        self._refs.start()
        self.addCleanup(self._refs.stop)

    def test_status_is_configuration_presence_only_and_missing_key_is_actionable(self):
        self.assertEqual(self.client.get("/api/ai/status").json(), dict(provider="qwen", model="qwen3-vl-flash", configured=False))
        response = self.client.post("/api/annotations/ai", json=sample())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "not_configured")

    def test_validation_never_echoes_image_data(self):
        invalid = {**sample(), "classes": []}
        response = self.client.post("/api/annotations/ai", json=invalid)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(invalid["image_data_url"], response.text)
        response = self.client.post("/api/annotations/ai", content=b"x" * (MAX_BODY_BYTES + 1), headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)

    def test_origin_and_content_type_checked_before_model_call(self):
        with patch("server.main.generate_annotations", new_callable=AsyncMock) as generate:
            self.assertEqual(self.client.post("/api/annotations/ai", json=sample(), headers={"Origin": "https://untrusted.example"}).status_code, 403)
            self.assertEqual(self.client.post("/api/annotations/ai", content="{}").status_code, 415)
            generate.assert_not_called()

    def test_endpoint_model_adapter_integration(self):
        async def fake(request, settings):
            return await generate_annotations(request, Settings("fake-key"), transport=httpx.MockTransport(lambda _: httpx.Response(200, json=model_reply())))

        with patch("server.main.generate_annotations", side_effect=fake):
            response = self.client.post("/api/annotations/ai", json=sample(), headers={"Origin": "chrome-extension://test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "qwen")
        self.assertEqual(response.json()["objects"][0]["class_id"], 9)


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.refs = Path(self.tmp.name)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def _reference(self, **overrides):
        buffer = BytesIO()
        Image.new("RGB", (320, 240), (10, 20, 30)).save(buffer, format="JPEG")
        payload = dict(classes=[dict(id=3, name="工件"), dict(id=9, name="part")],
                       class_id=9, input_width=320, input_height=240,
                       image_data_url="data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode())
        payload.update(overrides)
        return payload

    def test_project_key_is_order_independent(self):
        a = [ProjectClass(id=3, name="工件"), ProjectClass(id=9, name="part")]
        b = [ProjectClass(id=9, name="part"), ProjectClass(id=3, name="工件")]
        self.assertEqual(project_key(a), project_key(b))
        self.assertNotEqual(project_key(a), project_key([ProjectClass(id=3, name="工件")]))

    def test_save_and_load_references_roundtrip(self):
        request = ReferenceRequest(**self._reference())
        with patch("server.ai_service.REFERENCES_DIR", self.refs):
            save_reference(request)
            loaded = load_references(request.classes)
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["class_id"], 9)
        self.assertEqual(loaded[0]["class_name"], "part")
        self.assertTrue(loaded[0]["data_url"].startswith("data:image/jpeg;base64,"))

    def test_build_payload_adds_references_only_when_present(self):
        request = AIRequest(**sample())
        without = build_payload(request, "qwen3-vl-flash")
        self.assertEqual(without["messages"][1]["content"][0],
                         {"type": "image_url", "image_url": {"url": request.image_data_url}})
        refs = [{"class_id": 3, "class_name": "工件", "data_url": "data:image/jpeg;base64,AAAA"}]
        with_refs = build_payload(request, "qwen3-vl-flash", refs)
        content = with_refs["messages"][1]["content"]
        self.assertEqual(content[0]["type"], "text")
        self.assertIn("示例图", content[0]["text"])
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[-2]["image_url"]["url"], request.image_data_url)
        self.assertIn("所有可见实例", content[-1]["text"])

    def test_reference_endpoint_saves_and_rejects_bad_input(self):
        payload = self._reference()
        with patch("server.ai_service.REFERENCES_DIR", self.refs):
            ok = self.client.post("/api/references", json=payload, headers={"Origin": "chrome-extension://test"})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json(), {"ok": True})
            bad = self._reference(class_id=7)
            self.assertEqual(self.client.post("/api/references", json=bad,
                                              headers={"Origin": "chrome-extension://test"}).status_code, 422)
            extra = self._reference(image_id="unexpected")
            self.assertEqual(self.client.post("/api/references", json=extra,
                                              headers={"Origin": "chrome-extension://test"}).status_code, 422)
            self.assertEqual(self.client.post("/api/references", json=payload,
                                              headers={"Origin": "https://untrusted.example"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
