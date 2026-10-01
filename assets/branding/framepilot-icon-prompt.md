# FramePilot icon v1

生成方式：内置 image_gen。参考用户手绘四宫格，按文字要求使用红、黄、蓝三个 bbox 框，右下为红到紫的竖向色谱。图标为透明 PNG，原始尺寸 1254 × 1254。

图标：[framepilot-icon-v1.png](framepilot-icon-v1.png)。本次为图标设计稿，尚未配置到扩展 manifest。

## 初次生成提示词

```text
Use case: logo-brand.
Asset type: square browser extension icon for FramePilot, an AI bounding-box annotation assistant.
Input image role: the attached photograph is ONLY a hand-drawn layout reference. Turn its central four-part concept into one polished standalone icon. Ignore the paper, shadows, arrows, handwriting and photograph perspective.
Composition: one centered flat two-by-two grid, four equal square modules, perfectly aligned, consistent generous gaps, generous safe padding, all four modules together form a square. The mark should fill about 85 percent of a square canvas and remain clear as a small browser extension icon.
Three modules are hollow bounding-box square frames with straight sides, minimally softened corners, bold identical stroke widths, and transparent empty centers:
TOP LEFT frame: saturated RED.
TOP RIGHT frame: golden YELLOW. IMPORTANT: the handwritten reference says green here, but the user's final written instruction overrides it: this frame MUST be yellow, NOT green.
BOTTOM LEFT frame: saturated BLUE.
BOTTOM RIGHT module: a filled square color-spectrum chart made of contiguous clean vertical bands progressing left to right through red, orange, yellow, green, cyan, blue and violet. All bands have equal height. No black dividers and no additional frame around this spectrum module.
Color palette: crisp primary red, golden yellow, blue; vivid but controlled rainbow only within the bottom-right module.
Style: very clean geometric, vector-like flat design, precise edges, balanced visual weight, bold legibility, professional software icon. Actual transparent background outside the shapes and inside the hollow frames. No overall enclosing tile.
Constraints: exactly four modules, three hollow colored frames and one filled spectrum panel. No text, no letters, no arrows, no labels, no extra marks, no mockup, no gradients or shadows on the three frames, no 3D, no paper texture, no watermark. Produce a single square PNG icon with real transparency, preferably 1024 by 1024.
```

## 清理提示词

```text
Use case: precise-object-edit.
Edit target: the supplied generated FramePilot four-module icon.
Fix ONLY raster noise and transparency contamination. Preserve the two-by-two layout, positions, scale, corner shapes, frame thicknesses, three frame colors (top-left red, top-right yellow, bottom-left blue), and bottom-right seven vertical spectrum bands.
The current red square contains unwanted colored speckles and blotches in its empty center. The yellow and blue square centers and edges also contain small stray colored pixels. Remove ALL such artifacts. Each of the three hollow frames must have a completely empty clean transparent center with zero markings. Outside the four modules must also be completely clean and transparent. Make all frame edges precise, straight and smoothly antialiased. Use uniform flat solid colors, without texture, mottling, glow or color noise.
Keep exactly three hollow frames and one filled rainbow square, with no new objects, letters, shadows or borders. Do not make any part of the actual colored strokes or rainbow transparent. Preserve real alpha transparency. Produce a clean square PNG software icon.
```

