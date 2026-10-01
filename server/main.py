"""Local annotation API. Mock results are suggestions awaiting human review."""

from typing import Annotated, Literal
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from server.ai_service import AIError, AIRequest, MAX_BODY_BYTES, generate_annotations, get_settings


app = FastAPI(title="AI Annotation Assistant", version="0.4.0")
app.mount("/demo", StaticFiles(directory=Path(__file__).parent / "demo", html=True), name="demo")

ImageDimension = Annotated[int, Field(strict=True, gt=0, le=1_000_000)]
ImageId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]


class MockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_id: ImageId
    image_width: ImageDimension
    image_height: ImageDimension


class AnnotationBox(BaseModel):
    id: str
    class_id: Literal[0] = 0
    class_name: Literal["part_A"] = "part_A"
    x: float = Field(ge=0, allow_inf_nan=False)
    y: float = Field(ge=0, allow_inf_nan=False)
    width: float = Field(gt=0, allow_inf_nan=False)
    height: float = Field(gt=0, allow_inf_nan=False)


class MockResponse(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    image_id: str
    image_width: int
    image_height: int
    source: Literal["mock"] = "mock"
    objects: list[AnnotationBox]
    review_status: Literal["pending"] = "pending"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "AI Annotation Assistant"}


@app.post("/api/annotations/mock", response_model=MockResponse)
def mock_annotations(request: MockRequest) -> MockResponse:
    """Generate one proportional test box without receiving an image or calling AI."""
    return MockResponse(
        image_id=request.image_id,
        image_width=request.image_width,
        image_height=request.image_height,
        objects=[AnnotationBox(
            id="box-1",
            x=request.image_width / 10,
            y=request.image_height / 10,
            width=request.image_width / 5,
            height=request.image_height / 5,
        )],
    )


@app.get("/api/ai/status")
def ai_status():
    """Local configuration presence only; this does not test the key or call Qwen."""
    settings = get_settings()
    return {"provider": "qwen", "model": settings.model, "configured": bool(settings.api_key)}


@app.post("/api/annotations/ai")
async def ai_annotations(request: Request):
    """Single image + classes. See docs/ai-setup.md for the JSON contract."""
    # The extension calls from its background worker. Arbitrary web origins are rejected.
    origin = request.headers.get("origin", "")
    if origin and not (origin.startswith("chrome-extension://") and len(origin.split("/")) == 3):
        return JSONResponse({"code": "invalid_origin", "detail": "请通过 Edge 扩展请求 AI 预标注。"}, status_code=403)
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        return JSONResponse({"code": "invalid_content_type", "detail": "需要 application/json。"}, status_code=415)
    # Bound even chunked requests before parsing; never echo image bytes in validation errors.
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            return JSONResponse({"code": "image_too_large", "detail": "请求图片过大，请使用较小的图片。"}, status_code=413)
        body.extend(chunk)
    try:
        payload = AIRequest.model_validate_json(body)
    except ValueError:
        return JSONResponse({"code": "invalid_request", "detail": "图片参数或类别表无效，请刷新页面重新选择。"}, status_code=422)
    try:
        return await generate_annotations(payload, get_settings())
    except AIError as error:
        return JSONResponse({"code": error.code, "detail": error.message}, status_code=error.status)
