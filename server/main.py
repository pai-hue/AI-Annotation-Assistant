"""Local annotation API. Mock results are suggestions awaiting human review."""

from typing import Annotated, Literal
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


app = FastAPI(title="AI Annotation Assistant", version="0.1.0")
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
