# DeepData Hub 原网站适配调查

日期：2026-09-30。依据：Edge 已登录页面的可见界面、DOM 及页面内联脚本，只读检查。未创建标注、未上传文件、未主动调用保存或数据集创建接口。

## 当前结论

原网站已有完整 Canvas 标注编辑器，可以研究通过页面主执行环境适配其原生标注数据。当前没有发现明确公开的扩展 API；以下是页面代码依据的候选方案，尚未验证实际写入。

初次只读调查时显示 0 / 0、类别为空；随后用户截图确认已准备图片及类别，项目共有 375 项，包含已有标注及新建 part 类别（截图 ID 9）。不能将初始 canvas 的 960×540 当作图片原始尺寸，也不能覆盖项目中已有的标注。

## 已观察到的入口

- 项目列表：https://www.threetone.com.cn/train/annotation
- 实际编辑器路径：`/train/annotation/{projectName}/editor`
- 页面 Canvas：`#editorCanvas`。
- 原网站按钮：保存进度、保存为数据集、导出 YOLO Zip。
- 页面路径带 `/train`；页面脚本会给以 `/` 开头的 fetch 路径补上 `/train`。适配时应根据实际路径处理，不能照抄脚本里的未加前缀 URL。

## 图片与类别

根据内联脚本：

- `loadProjectData()` 读取 `/annotation/${projectName}/data`，赋值 `classes = json.data.classes`、`annotations = json.data.images`、`images = json.images`。
- 当前图片以 `getSortedImages()[currentImageIdx]` 的文件名确定，不能直接使用未排序的 images 下标。
- 原图路径为 `/annotation/${projectName}/image/${filename}`；缩略图额外带 `/thumb`。
- 图片经内存及 IndexedDB 缓存，画布上没有可直接读取的普通 img DOM 元素。
- 正常图片加载后将 canvas.width/height 设为 imgObj.width/height，通过 CSS 缩放显示，标注采用原图像素。
- 播放模式可能使用缩略图；快速切图的占位状态可能保留上一张的 canvas 尺寸。预标注应只在原图确认加载完成、非播放状态下启用。
- 类别为字符串数组，class_id 是数组索引。删除类别可能引起 ID 重排，因此请求返回时必须再次核对类别表，发生变化则丢弃结果。

## 原生标注结构

手动画框与预设框逻辑使用：

```javascript
annotations[filename].push({
  x, y, w, h,
  class_id: currentClassIdx,
  img_w: canvas.width,
  img_h: canvas.height
});
```

服务的 width/height 应转换为 w/h，img_w/img_h 是原图尺寸。类别必须映射到当前项目索引，不直接写入演示用的 part_A/part_B。

原网站在创建框后调用 draw()、renderRectList()、renderImageList() 等刷新函数，部分路径还更新 classAnnotationCounts 和 renderClassList()。仅修改数组不足以保证列表和计数一致。

## 自动保存行为

已从脚本确认（尚未验证服务器持久化结果）：

- `debouncedSave()` 在 1 秒后调用 `saveData(false)`。
- 页面有 `setInterval(() => saveData(false), 30000)`。
- `saveData()` POST `/annotation/${projectName}/save`，请求体为 `{classes, images: annotations}`。
- “保存为数据集”另行调用 `/save_to_dataset`，与保存进度不同。

因此即使插件不调用保存函数，写入的初始框也可能被网站周期保存。插件应沿用原网站正常草稿/进度保存机制，不屏蔽定时保存，不触发保存为数据集、导出或审核完成。当前界面未见独立“审核通过”按钮，不能虚构原网站的审核状态字段。

## 候选适配架构

1. content script 注入预标注按钮，负责状态提示。
2. 小型 MAIN-world 适配脚本读取当前图片和类别，创建请求快照。页面使用顶层 let/const；不能假定变量在 window 上，也不能从隔离执行环境直接访问。
3. background 请求固定的本机服务；模拟阶段不传图片字节。真实模型阶段另行接入原图获取和服务端模型调用。
4. 页面适配器收到结果后再次核对项目、文件名、尺寸、类别表、加载状态和已有标注。已有框或状态变化则拒绝写入。
5. 全部框校验通过后一次性转换为原生结构，再更新网站标注列表、类别计数和画布。用户继续使用原网站的编辑和保存功能。

页面主环境变量可访问性、网站 CSP、准确加载状态判定和刷新副作用都需要验证。此方案是基于当前页面代码的推断，不是已验证的稳定 API；网站更新可能要求重新适配。

## 接入验收前提与下一步

- 在这个项目中准备至少一张可用于测试的图片及至少一个目标类别，或提供已有内容的标注项目。
- 先只读核对原图、类别表和当前标注，再实施模拟预标注适配。
- 对空标注图片写入模拟框后，应能在原网站正常选中、移动、缩放和删除；必须记录原网站自动保存行为。
- 验证切图、播放、类别变更、请求失败和重复点击不会污染数据。
- 初次调查只读；后续已实现下述适配代码，尚未在真实网站写入。

## v0.2.0 实施记录

- manifest 增加指定 HTTPS 标注页面的 MAIN 与隔离执行环境脚本，不申请所有网站权限。
- platform-main.js 读取当前项目上下文并校验原图缓存与 imgObj.src 一致；将服务模拟框映射到当前网站所选类别。
- platform-content.js 提供初始标注按钮和状态提示，后台仍请求固定本机接口。
- 已有框、播放、原图未就绪、请求中图片或类别变化、非法结果均拒绝写入。写入前校验全部结果，刷新失败同步回滚。
- 不调用 saveData、debouncedSave 或 saveAsDataset；网站自己的周期保存仍照常运行。无审核状态字段写入。
- 模拟阶段仅向本机发送随机请求 ID 和图片尺寸，不上传图片或发送项目/类别信息。
- 14 项 Node 模拟测试、4 项后端 HTTP 测试通过；真实 MAIN 环境访问、站点 CSP、原生编辑及自动保存结果仍待用户加载新版扩展后验证。
