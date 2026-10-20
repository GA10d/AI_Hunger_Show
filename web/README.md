# web：AI 饥饿秀前端（8-bit 像素风）

纯静态页面，不需要构建。两种打开方式：

- **有后端**：`cd script && python -m ai_related.server`，打开 http://127.0.0.1:8000 。实时模式，右上角标签显示 `LIVE`。
- **没后端**：直接双击 `index.html`。演示模式，播放 `js/demo.js` 里的一段流程（标签显示 `DEMO`）。

```
web/
├─ index.html          页面骨架：演出区 + 2×2 按钮 + 对话区 + 角色页弹窗
├─ css/style.css       像素风样式（调色板、像素边框、响应式）
├─ js/sprites.js       像素图（文本位图 → SVG）：头像 p0~p7、图标、石碑、木十字架、骷髅、蜡烛
├─ js/stage.js         演出区：选手在夜景里逛街、表情、说话、遗言、宣告、五种天罚、通关（canvas，自适应尺寸）
├─ js/chat.js          对话区：气泡队列、打字机、遗言气泡（墓碑形）、死亡框、入场分隔条
├─ js/roles.js         墓园：墓碑列表 → 人物生平（文件名沿用 roles）
├─ js/scripture.js     圣言：这个世界的每一条世界观 + 被触发的次数
├─ js/info.js          信息：游戏规则（图文简介）/ 特殊角色（出现过才解锁，点开看详细机制）
├─ js/music.js         音乐：开关、清单循环播放（清单来自 ../music/playlist.js）
├─ js/votes.js         观众投票：点头像弹出 👍 / 👎，头像下面挂计数，所有观众同步
├─ js/demo.js          演示数据（没连后端时用）
├─ js/app.js           入口：把后端事件（SSE）或演示数据接到画面上
└─ assets/             Fusion Pixel 12px 简体像素字体（OFL 协议）、favicon
```

## 和后端的接口

- `GET /api/events`（SSE）：事件流。刚连上时先回放最近的历史（带 `replay: true`，页面瞬间渲染），之后是实时事件。
  `spawn`（选手入场，带 `personality: {virtue, flaw}` 和 `intro` 一句自述；复活的人还带 `revived: {from, life, died_round, kind}`）/ `message`（`who: env | player`；选手对同伴说悄悄话时带 `to: 同伴的名字`）/ `lastwords`（遗言）/ `guess`（宣告）/ `verdict`（审判，`correct`）/
  `death`（带完整墓碑记录，含 `personality`）/ `victory`（胜利，同胞获释）/ `stop` / `error`。
  环境的 `message` 在它刚念过回声墙时带 `echo: {lines, new}`：`lines` 是它念的那几行（从新到旧，被抹掉的字已经是「□」，原字不会发给页面），前 `new` 行是刚刻上去的。
  选手的 `message` / `lastwords` / `guess` 还可能带 `thought`（他脑子里想的，只给观众看，页面画成虚线的“心想”气泡）。
  所有事件都带 `session`（后端每次启动不同，页面据此清掉上一次"在世"的人），大部分带 `round`（世界的绝对轮数，显示在舞台标签上）。
  稀有的选手：选手的事件（`spawn` 的 `player`、`message` / `lastwords` / `guess`、墓碑记录）带 `special: revived | catgirl | bard | gambler | medium | believer | earthbound | chronicler | lover`，复活的人还带 `life`（第几世）和 `revived_from`（前世的墓碑 id），恋人带 `lover`（另一半的名字）。
  赌徒的 `spawn` 带 `gamble: won | lost`；收到史官遗言的新人，`spawn` 带 `legacies: [史官的名字]`。几种只属于稀有身份的事件：`lovers`（`players: [{id, name, avatar} × 2]`）/ `vision`（通灵者看见的轮廓，`items: [{line, outline}]`）/
  `haunt`（地缚灵出现）/ `message` + `who: "ghost"`（地缚灵对 `to` 低语）/ `ghost_gone`（`reason: dispersed | faded | freed`）。死因多了 `heartbreak`（殉情）和 `murdered`（被同伴杀害，墓碑记录带 `killed_by`，凶手的记录带 `kills`）；
  选手的 `message` 带 `act: kill`（下杀手，还带 `target` / `target_id`）或 `act: end_life`（诀别）时，页面换成专门的框；地缚灵的墓碑记录带 `ghost: {whispers, end}`。
  稀有身份的头像 `cat` `bard` `gambler` `medium` `believer` `earthbound` `chronicler` 不在 p0~p7 的随机池里。`lastwords` 改写遗言时带 `revised: true`。猫娘用专属头像 `cat`（不在 p0~p7 的随机池里）。
- `GET /api/graveyard`：墓园，按死亡先后排列。记录字段：`id, name, avatar, rounds, cause, biography, last_words, kind, born_round, died_round, died_at, votes`（`votes = {up, down}`，观众的评价，死亡那一刻封存）。
  `kind`：`natural` 寿命耗尽 / `execution` 违规被处决 / `suicide` 自尽 / `wrong_guess` 宣告错误 / `victory` 胜利（墓园里显示成金星）。
- `GET /api/specials`：特殊角色页。`{seen: {身份: {count, first: {name, avatar, round}}}, chances: {身份: 概率}}`。`seen` 里没有的身份在页面上是锁着的（只显示稀有度）；身份的说明文字写在 `info.js` 里。
- `GET /api/scripture`：圣言。`[{id, kind: rule | truth, count, title, text}]`，`count` 是这条规则被触发的次数。
  **还没揭示的条目没有 `title` / `text`，只有 `hidden: true`**（页面显示成「？？？」）：规则在第一次被触发时揭示，
  世界的本质（`truth`）要等有人宣告成功（墓园里出现胜利者）才揭示。内容在后端就被拿掉了，不是前端藏起来的。
  事件流里每次有规则生效还会推一条 `scripture` 事件（页面用它让“圣言”按钮闪一下）。
- `GET /api/state`：在世的选手（最多两位）、当前轮数、是否在运行、已花费用。前端靠它判断后端在不在；没在运行时舞台直接拉上警戒线（「维修中」）。
- 观众投票（按句）：`POST /api/vote` `{player_id, message_id, vote: 1 | -1 | 0, viewer}`（0 = 撤回）。选手的 `message` / `lastwords` / `guess` 都带 `mid`（这一句的编号），每位观众对每一句各有一票；`message_id` 不是这个选手说的话返回 404，同一个地址最多带 6 个 viewer id（429）。`GET /api/votes?viewer=` 返回 `tallies: {players: {pid: {up, down}}, messages: {mid: {up, down}}}`（选手的总数 = 他所有句子之和）和这位观众投过的 `mine: {mid: 1 | -1}`。计数变化时事件流推一条**具名**事件 `event: votes`（同样的 `tallies`，不进历史记录），`/api/poll` 的回复里也带 `votes`。死去的选手照样能投。票存在数据目录的 `votes.json`（重启不丢）；`/api/graveyard` 返回的墓碑带实时的 `votes` / `message_votes`。事件流里的 `votes` 第一次是全部，之后只推变了的；`/api/poll` 带 `votes_after`，回复里的 `votes_version` 下次带回来。
- `/music/<文件>`：音乐文件（支持 Range，可以随意拖动 / 跳转）。页面里用相对路径 `../music/<文件>` 引用，
  所以从磁盘直接打开、VSCode Live Server（以仓库根目录为根）、python 服务器三种方式都找得到。

对话区的特殊条目（`chat.js`）：`message` + `to`（悄悄话：紫色气泡，名字后面写着「→ 同伴」）、`persona`（入场时的性格卡：一个优点绿、一个缺点红）、`message` + `thought`（心想：虚线暗色气泡，没有头像，字出得更快，出现在对应发言之前）、`message` + `ghost`（遗言轮：墓碑形气泡）、`death`（死亡轮：红黑死亡框，点开生平）、
`sacred`（宣告 / 审判 / 获释：神圣拱顶，`variant` 为 `guess` `deny` `grant` `freedom`）、`echo`（回声墙：灰白砖墙，字迹一行行浮现，「□」画成闪红光的空框，紧跟在念它的那句环境发言后面）、`divider`（入场/暂停）。
调试：演示数据（`js/demo.js`）里有以上全部种类，直接双击 `index.html` 就能看到。

## 常用操作

- **新增选手头像**：在 `sprites.js` 的 `AVATAR_STYLES` 里加一项（`p8`…），并在后端 `game.py` 的 `AVATARS` 里加上同样的 id。
- **改图标 / 头像**：直接改 `sprites.js` 里的字符画（12×12，每个字符一个像素，`.` 透明）。
- **演出区**：`#stage-canvas` 铺满演出区，逻辑分辨率由 `stage.js` 的 `fitStage()` 按容器尺寸算出（整数倍放大、保持像素锐利）。
  小人是用头像拼出来的（头 + 身体 + 腿，按姿势 × 表情 × 头像缓存）；`app.js` 在对话气泡**开始显示**的那一刻调用 `HungerStage.spawn / say / think / envSay / lastWords / declare / die / victory / reset`，所以动画和对话同步。
  历史回放（`replay` 或 `?instant`）只还原状态（谁在场、有几块碑），不演动画。`die(record, {variant})` 的 `variant` 可以指定天罚：`spear | hands | burst | chains | rune`，不指定就随机。
  左上角的角标由 `app.js` 的 `setMode` 控制：LIVE（红点闪烁）/ DEMO（琥珀色）/ 断线（灰色）；左下角只写轮数。
- **调试参数**：`?instant` 跳过打字机效果和入场动画；`?demo` 强制演示模式；`?empty` 演示模式下不放对话；`?roles=list|detail` 打开时直接弹出墓园；`?scripture` 打开时直接弹出圣言；`?info=rules|specials` 打开时直接弹出信息；`?paused` 舞台一直显示「维修中」。

## 适配

- 手机竖屏：单列，宽度跟随屏幕（已测 320 / 360 / 390px）；≤430px 时墓园条目改成紧凑排布。
- 手机横屏 / 矮窗口（高度 ≤ 520px）：自动切成左右分栏（左：演出区 + 按钮，右：对话）。
- 电脑（≥ 900×600）：竖条放宽到 1000px；大屏显示器（≥ 1600×800）放宽到 1200px。按钮、图标、头像按整数倍放大，选手消息靠右、环境消息靠左。
- 平板：居中的 480px 竖条，两侧是棋盘格底纹。
- 已处理刘海屏安全区（`env(safe-area-inset-*)`）和手机双击缩放。
- 图标和头像是 12 格位图，尺寸必须是 12 的整数倍（36 / 48 / 60 / 72px），否则像素会发糊。新增断点时注意这一点（见 `style.css` 里的 `--icon`、`--av`）。
- 对话里的名字和台词都用 `textContent` 渲染（内容来自 LLM，不能当 HTML 解析）。
