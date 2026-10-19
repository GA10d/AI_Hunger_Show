# prompts/：引擎自己的 prompt

`words/<world>/` 里放的是**某一个世界**的设定（人设、环境、隐藏规则、标准答案）。
这个文件夹放的是**所有世界共用**的那一层：游戏规则说明、每回合的指令、系统通知、裁判的输出格式、史官、记忆压缩……
代码会把它们拼到世界设定的后面，或者在游戏进行中发给模型。代码里不再写死任何发给模型的文字。

改完之后**重启服务**才会生效（文件在启动时读一次）。

## 某个世界自己的版本

这里的文字是所有世界的默认值，尽量写得不带任何世界的味道。某个世界想换个说法，就在 `words/<world>/prompts/` 下按**同样的路径**放一份，不用动这里：

- **`*.md`**：整份替换。比如 `words/corridor/prompts/judge/oracle_format.md` 存在，corridor 就用它，不用 `prompts/judge/oracle_format.md`。
- **`strings.json`**：只写要改的键，其余的照旧用这里的。值是 `{...}` 的键（比如 `kind_text`）也是逐项合并的，只写要改的那一项就行。

`arena/*` 是不属于任何世界的双人演示，不能这样替换。

现在这样做的：`corridor` 和 `turtle` 都换上了「门外的存在」「住客」「白光」「锁链断开，所有同胞获得了自由」这些说法，见各自的 `prompts/` 文件夹：

- `judge/oracle_format.md`、`judge/oracle_request.md`
- `judge/strings.json` 的 `oracle_silent`、`wrong_guess_scene`
- `historian/strings.json` 的 `kind_text.victory`、`victory_cause`

## 两种文件

- **`*.md`**：一整段 prompt，原样读出（首尾空白会去掉）。
- **`strings.json`**：短句、标签和 json 示例，按键名取用。键名别改，代码靠它找。

## 占位符

`{round}`、`{name}` 这样的 **`{小写英文}`** 是占位符，运行时由代码填进去。

- 可以挪位置、改周围的字，但**别删、别改名**，否则那一处就填不进内容了。
- 只有代码传了值的占位符才会被替换。其他花括号，比如 json 示例里的 `{"verdicts": []}`，保持原样，不用转义。
- 填进去的内容不会再被展开：选手说的话里就算写了 `{name}`，也不会被替换。

## 文件一览

| 文件 | 发给谁 | 什么时候用 | 占位符 |
|---|---|---|---|
| `fallback/tribute.md` | 选手 | 世界的 `tribute.md` 还是空的（不到 30 字）时，代替它 | – |
| `fallback/playground.md` | 环境 | 世界的 `playground.md` 还是空的时，代替它 | – |
| `player/rules.md` | 选手 | 拼在人设后面：游戏规则、可选的行动、输出格式 | `{options}` 行动列表、`{actions}` 可选的 action 值 |
| `player/turn.md` | 选手 | 每次轮到他 | `{round}`、`{field}` 场上有谁、`{options}` 本回合可选的行动 |
| `player/personality.md` | 选手 | 出生时抽到的性格 | `{virtue}` `{virtue_desc}` `{flaw}` `{flaw_desc}` |
| `player/strings.json` | 选手 | 取名、内心独白、继承遗言、同伴入场 / 死亡通知、悄悄话、行动说明 | 见各条 |
| `env/rules.md` | 环境 | 拼在 `playground.md` 后面 | – |
| `env/strings.json` | 环境 | 新选手入场、回声墙、死亡现场、同场轮数 | 见各条 |
| `judge/judge_format.md` | 裁决者 | 拼在 `judge.md` 后面：输出格式 | – |
| `judge/oracle_format.md` | 审判者 | 拼在 `oracle.md` 后面：输出格式 | – |
| `judge/check_action.md` | 裁决者 | 每次行动之后 | `{state}` `{player}` `{action}` `{content}` |
| `judge/check_round.md` | 裁决者 | 每一轮结束 | `{state}` `{log}` |
| `judge/oracle_request.md` | 审判者 | 有人宣告真相 | `{declaration}` |
| `judge/strings.json` | 裁决者 / 审判者 | 当前状态、行动记录的写法；宣告失败、审判者沉默时的默认台词 | 见各条 |
| `historian/system.md` | 史官 | 有人死亡或胜利 | `{event}` `{example}` |
| `historian/request.md` | 史官 | 同上：这位选手的经历 | `{name}` `{personality}` `{age}` `{ending}` `{detail}` `{last_words}` `{story}` |
| `historian/strings.json` | 史官 / 观众 | 各种结局的说法、经历的标签、史官失败时的默认生平 | 见各条 |
| `memory/system.md` | 记忆整理器 | 上下文太长、需要压缩时 | `{owner}` `{example}` |
| `memory/request.md` | 记忆整理器 | 同上 | `{previous}` `{transcript}` |
| `memory/strings.json` | 记忆整理器 / 选手 | 摘要的 json 示例、各段标题、摘要前缀 | 见各条 |
| `agent/strings.json` | 所有 Agent | 要求只输出 json 的那句话；没有新消息时的「请继续发言」 | `{example}` |
| `arena/*` | 演示用 | `python -m ai_related.run_arena` 的双人对话 | `{name}` |

## 仍然留在代码里的

这些是程序之间的约定，不是 prompt，改了会出问题：

- 说话人的名字「环境」「系统」，消息前缀「【某某】」，以及悄悄话对象的别名「同伴」「对方」
- 回声墙上代替被抹掉的字用的「□」
- 把名字括成「」、用「、」或「 或 」连接列表的写法
- 终端输出（`run_game.py`）和启动器界面上的文字
