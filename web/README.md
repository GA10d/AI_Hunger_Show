# web：AI 饥饿秀前端（8-bit 像素风）

纯静态页面，不需要构建。两种打开方式：

- **有后端**：`cd script && python -m ai_related.server`，打开 http://127.0.0.1:8000 。实时模式，右上角标签显示 `LIVE`。
- **没后端**：直接双击 `index.html`。演示模式，播放 `js/demo.js` 里的一段流程（标签显示 `DEMO`）。

```
web/
├─ index.html          页面骨架：演出区 + 2×2 按钮 + 对话区 + 角色页弹窗
├─ css/style.css       像素风样式（调色板、像素边框、响应式）
├─ js/sprites.js       像素图（文本位图 → SVG）：头像 p0~p7、图标、石碑、木十字架、骷髅、蜡烛
├─ js/stage.js         演出区占位画面（canvas，自适应尺寸）
├─ js/chat.js          对话区：气泡队列、打字机、遗言气泡（墓碑形）、死亡框、入场分隔条
├─ js/roles.js         墓园：墓碑列表 → 人物生平（文件名沿用 roles）
├─ js/demo.js          演示数据（没连后端时用）
├─ js/app.js           入口：把后端事件（SSE）或演示数据接到画面上
└─ assets/             Fusion Pixel 12px 简体像素字体（OFL 协议）、favicon
```

## 和后端的接口

- `GET /api/events`（SSE）：事件流。刚连上时先回放最近的历史（带 `replay: true`，页面瞬间渲染），之后是实时事件。
  `spawn`（选手入场）/ `message`（`who: env | player`）/ `lastwords`（遗言）/ `death`（带完整墓碑记录）/ `stop` / `error`。
  所有事件都带 `session`（后端每次启动不同，页面据此清掉上一次"在世"的人），大部分带 `round`（世界的绝对轮数，显示在舞台标签上）。
- `GET /api/graveyard`：墓园，按死亡先后排列。记录字段：`id, name, avatar, rounds, cause, biography, last_words, born_round, died_round, died_at`
- `GET /api/state`：在世的选手（最多两位）、当前轮数、是否在运行、已花费用。前端靠它判断后端在不在。

对话区的三种特殊条目（`chat.js`）：`message` + `ghost`（遗言轮）、`death`（死亡轮）、`divider`（入场/暂停）。

## 常用操作

- **新增选手头像**：在 `sprites.js` 的 `AVATAR_STYLES` 里加一项（`p8`…），并在后端 `game.py` 的 `AVATARS` 里加上同样的 id。
- **改图标 / 头像**：直接改 `sprites.js` 里的字符画（12×12，每个字符一个像素，`.` 透明）。
- **演出区**：`#stage-canvas` 铺满演出区，逻辑分辨率由 `stage.js` 的 `fitStage()` 按容器尺寸算出（整数倍放大、保持像素锐利）。`drawStage` 是占位画面，之后换成 sprite 演出。
- **调试参数**：`?instant` 跳过打字机效果和入场动画；`?demo` 强制演示模式；`?empty` 演示模式下不放对话；`?roles=list|detail` 打开时直接弹出角色页。

## 适配

- 手机竖屏：单列，宽度跟随屏幕（已测 320 / 360 / 390px）；≤430px 时墓园条目改成紧凑排布。
- 手机横屏 / 矮窗口（高度 ≤ 520px）：自动切成左右分栏（左：演出区 + 按钮，右：对话）。
- 电脑（≥ 900×600）：竖条放宽到 1000px；大屏显示器（≥ 1600×800）放宽到 1200px。按钮、图标、头像按整数倍放大，选手消息靠右、环境消息靠左。
- 平板：居中的 480px 竖条，两侧是棋盘格底纹。
- 已处理刘海屏安全区（`env(safe-area-inset-*)`）和手机双击缩放。
- 图标和头像是 12 格位图，尺寸必须是 12 的整数倍（36 / 48 / 60 / 72px），否则像素会发糊。新增断点时注意这一点（见 `style.css` 里的 `--icon`、`--av`）。
- 对话里的名字和台词都用 `textContent` 渲染（内容来自 LLM，不能当 HTML 解析）。
