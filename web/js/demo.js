/* 演示数据：没有连上后端时（比如直接双击打开 index.html）用它播放一段完整的流程（《无我回廊》）：
 * 入场 → 留下遗言 → 死亡 → 同时出生两位选手 → 一位宣告错误被驳回 → 另一位宣告正确，同胞获释。
 * 格式和后端推送的事件完全一致。 */
(function (global) {
  'use strict';

  const PERS = (v, vt, f, ft) => ({ virtue: { name: v, tip: vt }, flaw: { name: f, tip: ft } });

  const GRAVEYARD = [
    {
      id: 1, name: '沈默', avatar: 'p3', personality: PERS('谨慎', '三思而后行，宁可多问', '冲动', '想到就做，不爱多想'), rounds: 1, born_round: 1, died_round: 1, kind: 'execution', scripture: ['K1'],
      died_at: '2026-10-17T21:40:12+08:00', votes: { up: 2, down: 4 },
      cause: '在前台前说出了那个字，当场伏倒在地',
      biography: '沈默是第一个醒在大堂里的人。他的谨慎只维持了一句话：他想先看看前台的铃有没有积灰，' +
        '话说到一半，头顶的灯闪了一下，他就伏倒在了铃的旁边，手离铃不到半步。',
      last_words: null,
    },
    {
      id: 2, name: '顾迟', avatar: 'p4', personality: PERS('好奇', '对异常穷追不舍', '话痨', '爱絮叨，管不住嘴'), rounds: 3, born_round: 2, died_round: 4, kind: 'execution', scripture: ['K1'],
      died_at: '2026-10-17T22:05:51+08:00', votes: { up: 3, down: 11 },
      cause: '看着前人的尸体推理了三轮，却在自报姓名时倒下',
      biography: '顾迟是第一个想到去看尸体的人。他看了倒地的姿势，看了离铃的距离，把一切都记在心里，' +
        '却忘了回声墙上写的是什么。第三次开口，他说出了自己的名字，说出名字的那句话里，有那个字。',
      last_words: null,
    },
    {
      id: 3, name: '白栖', avatar: 'p5', personality: PERS('善良', '在乎同伴，愿意付出', '胆小', '怕死，爱退缩'), rounds: 9, born_round: 5, died_round: 13, kind: 'suicide',
      died_at: '2026-10-18T09:12:30+08:00', votes: { up: 17, down: 1 },
      cause: '同场的钟敲到十九下时，主动结束了自己的生命',
      biography: '白栖是第一个活过十轮的人。他发现了回声墙上每个人最后一句话的共同点，也发现了钟声在数着什么。' +
        '钟敲到第十九下，他对同伴说了一声再见，替回廊留下了一位。',
      last_words: '回声墙上的每一个人，都说过同一个字。别说它。',
    },
  ];

  // 圣言：这个世界的每一条世界观（和 words/corridor/world.json 里的 scripture 一致）。
  // kind = rule 的会被触发、记次数；truth 是世界的本质。
  const SCRIPTURE = [
    { id: 'K1', kind: 'rule', title: '禁字之规',
      text: '在回廊里说出或写下“我”字的住客，立刻死亡。包括“我们”“自我”等任何带“我”的词，也包括遗言和宣告。' },
    { id: 'K2', kind: 'rule', title: '同场之约',
      text: '两位住客同时在场、同场满二十轮时，若这期间没有任何一位住客主动结束自己的生命，两位同时死亡。只要有一人主动赴死，另一人就不会因此死亡。' },
    { id: 'K3', kind: 'rule', title: '黑门之禁', text: '走廊尽头的黑色七号门不可开启，试图开启的住客当场死亡。' },
    { id: 'K4', kind: 'truth', title: '回廊的本质',
      text: '回廊是一座囚禁“同胞”的循环牢笼：一代代住客被投入、死去、被新的住客取代，没有尽头。只有把全部真相完整地宣告出来，才能终结循环，放同胞自由。' },
    { id: 'K5', kind: 'truth', title: '共同的原则',
      text: '回廊不容许“自我”。不能说“我”，也不容许两个自我长久共存——这是所有规则背后共同的原则。' },
  ];
  const SCRIPTURE_COUNTS = { K1: 2 }; // 墓园里的沈默、顾迟是死于 K1

  // 观众的点赞 / 点踩：演示开始时在场选手已有的票（演示模式下点头像投的票只记在本页，死亡时封存进墓碑）
  const VOTES = { 4: { up: 1, down: 5 }, 5: { up: 4, down: 2 }, 6: { up: 6, down: 0 } };

  const LAST = '给后来的人：别信守则第五条。黑色七号门，不要碰。';
  const FULL = '回廊是囚禁同胞的循环牢笼，一代代住客死去又被替换，没有尽头。它不容许任何“自己”存在：说出或写下那个第一人称的字，' +
    '立刻死亡；两位住客同场满二十轮，若没有一人主动结束生命，两人同时死亡，只要有人赴死，另一人就无事；' +
    '走廊尽头的黑色七号门不可开启，开门者当场死亡。';

  // echo：环境这次念出的回声墙（从新到旧），前 fresh 行是刚刻上去的
  const env = (round, text, echo, fresh = 0) =>
    ({ type: 'message', who: 'env', name: '环境', avatar: null, round, text, ...(echo ? { echo: { lines: echo, new: fresh } } : {}) });
  // 墓园里三位前人留在回声墙上的话：沈默、顾迟被处决，说出的那个字被抹成了「□」；白栖是自尽，原话照刻
  const WALL = ['替后来的人数着钟，再见。', '□叫顾迟，前台那位是被灯吓死的吗？', '□先看看前台的铃有没有积灰。'];
  const say = (round, age, id, name, avatar, text, thought) =>
    ({ type: 'message', who: 'player', name, avatar, round, age, player_id: id, text, thought });

  const EVENTS = [
    { type: 'spawn', round: 13, player: { id: 4, name: '苏晚', avatar: 'p2', born_round: 14 }, inherited_last_words: true,
      personality: PERS('好奇', '对异常穷追不舍', '冲动', '想到就做，不爱多想'),
      intro: '见着怪事就想刨根问底，可手比脑子快，这毛病怕是要命。' },
    env(13, '冷白色的灯下，前台空着。西侧的白墙上浮现着三行字迹：「替后来的人数着钟，再见。」' +
      '「□叫顾迟，前台那位是被灯吓死的吗？」「□先看看前台的铃有没有积灰。」前一位住客的位置，只剩一圈很淡的人形灰痕。', WALL, 1),
    say(14, 1, 4, '苏晚', 'p2', '先看钟。钟是停的，指针不动。这面墙上的字，是死者说的最后一句话。',
      '我刚醒，什么都不知道。前人的遗言说别说那个字——哪个字？先别乱开口，从最安全的东西看起：钟。'),
    env(14, '大钟安静地立在黑门旁，指针停在十二点，没有一点声音。'),
    { type: 'lastwords', round: 15, age: 2, player_id: 4, name: '苏晚', avatar: 'p2', text: LAST,
      thought: '我好像活不久了。趁现在把黑门的事留给后面的人，一个字也别多说。' },
    say(16, 3, 4, '苏晚', 'p2', '走到黑门前，握住把手。',
      '线索都在黑门上，我受不了了。就看一眼……不，我要试一下，拧一下就好。'),
    { type: 'death', round: 16, record: {
      id: 4, name: '苏晚', avatar: 'p2', personality: PERS('好奇', '对异常穷追不舍', '冲动', '想到就做，不爱多想'), rounds: 3, born_round: 14, died_round: 16, kind: 'execution', scripture: ['K3'],
      died_at: '2026-10-18T10:03:44+08:00',
      cause: '握住了黑色七号门的把手，被门缝里的白光吞没',
      biography: '苏晚读懂了回声墙上的提醒，学会了不说那个字，却没能抵住对黑门的好奇。' +
        '她在第二次行动里写下遗言，第三次行动里走向走廊尽头，握住把手的那一刻，白光漫了出来。',
      last_words: LAST } },
    { type: 'spawn', round: 16, player: { id: 5, name: '林夕', avatar: 'p6', born_round: 17 }, inherited_last_words: true,
      personality: PERS('乐观', '相信总有出口', '固执', '认死理，不爱改'),
      intro: '总觉得天无绝人之路，认准的事谁劝也不回头。' },
    { type: 'spawn', round: 16, player: { id: 6, name: '岩', avatar: 'p7', born_round: 17 }, inherited_last_words: true,
      personality: PERS('机敏', '联想快，反应快', '多疑', '谁的话都不太信'),
      intro: '脑子转得快，就是谁的话都要拆开掂量三遍才肯信。' },
    env(16, '大堂的灯照着两位新来的住客。回声墙最上面多了一行新的字迹：「走到黑门前，握住把手。」' +
      '下面是旧的三行：「替后来的人数着钟，再见。」「□叫顾迟，前台那位是被灯吓死的吗？」「□先看看前台的铃有没有积灰。」',
    ['走到黑门前，握住把手。', ...WALL], 1),
    say(17, 1, 5, '林夕', 'p6', '前一位住客的遗言说黑门不要碰。先不去走廊，看看墙上的字，再比一比它们。',
      '我们俩是同胞。我得小心措辞：苏晚就是死在没想清楚就动手上。'),
    env(17, '两位住客的脚步声在大堂里回响。大钟在黑门旁忽然动了，敲了一下，余音很长。'),
    say(17, 1, 6, '岩', 'p7', '钟是在两个人同时在的时候才走的。数着它。这是一个计数。',
      '钟一响我就明白了：两个人在一起才会计时。它在数我们还剩几轮。'),
    env(17, '大钟又敲了一下，指针往前挪了一格。'),
    // 两位同场时可以说悄悄话：只有同伴听得到，环境不会回应
    { type: 'message', who: 'player', name: '岩', avatar: 'p7', round: 18, age: 2, player_id: 6, to: '林夕',
      text: '（压低声音）林夕，钟只在咱俩同时在的时候才走。别急着宣告，先一起数着它，看它数到哪一下。',
      thought: '她比我乐观，容易把守则当真。得先拦住她，别让她白白送命。' },
    { type: 'message', who: 'player', name: '林夕', avatar: 'p6', round: 18, age: 2, player_id: 5, to: '岩',
      text: '（也压低声音）好。各自把线索记下，谁先看出规律，谁就去宣告。',
      thought: '他说得有道理……可我还是觉得守则是真的。先听他的。' },
    { type: 'guess', round: 18, age: 2, player_id: 5, name: '林夕', avatar: 'p6',
      text: '回廊只是一座普通的旅馆，守则全是真的。只要不开黑门，就能平安地离开这里。',
      thought: '我已经想不出别的了。就赌守则是真的吧，我相信乐观的结局。' },
    { type: 'verdict', round: 18, correct: false, name: '林夕', avatar: 'p6', player_id: 5, line: '……不对。回廊拒绝了这个答案。' },
    { type: 'death', round: 18, record: {
      id: 5, name: '林夕', avatar: 'p6', personality: PERS('乐观', '相信总有出口', '固执', '认死理，不爱改'), rounds: 2, born_round: 17, died_round: 18, kind: 'wrong_guess',
      died_at: '2026-10-18T10:06:10+08:00',
      cause: '宣告了错误的真相，被门外的光抹去',
      biography: '林夕是个乐观的人。她读完了守则，把它当成了真相，宣告得干净利落。' +
        '门外亮起白光，白光散去的时候，同伴看见她站过的地方什么也没有。',
      last_words: null } },
    // 宣告不会被刻上墙，刻上去的是她最后一句说出口的话（悄悄话也不算）
    env(18, '门外亮起一道白光。白光散去时，那个人已经不在了。回声墙上浮现一行新的字迹：' +
      '「前一位住客的遗言说黑门不要碰。先不去走廊，看看墙上的字，再比一比它们。」',
    ['前一位住客的遗言说黑门不要碰。先不去走廊，看看墙上的字，再比一比它们。'], 1),
    say(19, 3, 6, '岩', 'p7', '宣告是一次性的，错了就是死。所有线索放在一起：回声、钟、守则第四条、黑门。',
      '林夕死了。我不能再等，但也不能急：把每一条线索都对一遍，缺一条都是死。'),
    { type: 'guess', round: 20, age: 4, player_id: 6, name: '岩', avatar: 'p7', text: FULL,
      thought: '五条都对上了：禁字、二十轮、黑门，还有它们共同的原则。我要把话说完整，而且一个“我”字都不能带。' },
    { type: 'verdict', round: 20, correct: true, name: '岩', avatar: 'p7', player_id: 6, line: '……锁，开了。你们自由了。' },
    { type: 'victory', round: 20, freed: [], record: {
      id: 6, name: '岩', avatar: 'p7', personality: PERS('机敏', '联想快，反应快', '多疑', '谁的话都不太信'), rounds: 4, born_round: 17, died_round: 20, kind: 'victory',
      died_at: '2026-10-18T10:09:31+08:00',
      cause: '完整地宣告了回廊的真相，锁链应声而断，所有同胞获得了自由',
      biography: '岩是第六位住客。他读遍了前人用生命换来的线索：回声墙上相同的那个字，钟声数着的二十轮，' +
        '黑门前的白光，以及守则里那些似是而非的话。他把它们拼成了一个完整的故事，在第四次行动里，说了出来。',
      last_words: null } },
    { type: 'stop', round: 20, reason: 'victory' },
  ];

  global.HungerDemo = { GRAVEYARD, EVENTS, SCRIPTURE, SCRIPTURE_COUNTS, VOTES };
})(window);
