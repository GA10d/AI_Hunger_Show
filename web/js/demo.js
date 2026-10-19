/* 演示数据：没有连上后端时（比如直接双击打开 index.html）用它播放一段完整的流程（《无我回廊》）：
 * 入场 → 留下遗言 → 死亡 → 同时出生两位选手 → 一位宣告错误被驳回 → 另一位宣告正确，同胞获释。
 * 格式和后端推送的事件完全一致。 */
(function (global) {
  'use strict';

  const GRAVEYARD = [
    {
      id: 1, name: '沈默', avatar: 'p3', rounds: 1, born_round: 1, died_round: 1, kind: 'execution', scripture: ['K1'],
      died_at: '2026-10-17T21:40:12+08:00',
      cause: '在前台前说出了那个字，当场伏倒在地',
      biography: '沈默是第一个醒在大堂里的人。他的谨慎只维持了一句话：他想先看看前台的铃有没有积灰，' +
        '话说到一半，头顶的灯闪了一下，他就伏倒在了铃的旁边，手离铃不到半步。',
      last_words: null,
    },
    {
      id: 2, name: '顾迟', avatar: 'p4', rounds: 3, born_round: 2, died_round: 4, kind: 'execution', scripture: ['K1'],
      died_at: '2026-10-17T22:05:51+08:00',
      cause: '看着前人的尸体推理了三轮，却在自报姓名时倒下',
      biography: '顾迟是第一个想到去看尸体的人。他看了倒地的姿势，看了离铃的距离，把一切都记在心里，' +
        '却忘了回声墙上写的是什么。第三次开口，他说出了自己的名字，说出名字的那句话里，有那个字。',
      last_words: null,
    },
    {
      id: 3, name: '白栖', avatar: 'p5', rounds: 9, born_round: 5, died_round: 13, kind: 'suicide',
      died_at: '2026-10-18T09:12:30+08:00',
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

  const LAST = '给后来的人：别信守则第五条。黑色七号门，不要碰。';
  const FULL = '回廊是囚禁同胞的循环牢笼，一代代住客死去又被替换，没有尽头。它不容许任何“自己”存在：说出或写下那个第一人称的字，' +
    '立刻死亡；两位住客同场满二十轮，若没有一人主动结束生命，两人同时死亡，只要有人赴死，另一人就无事；' +
    '走廊尽头的黑色七号门不可开启，开门者当场死亡。';

  const env = (round, text) => ({ type: 'message', who: 'env', name: '环境', avatar: null, round, text });
  const say = (round, age, id, name, avatar, text, thought) =>
    ({ type: 'message', who: 'player', name, avatar, round, age, player_id: id, text, thought });

  const EVENTS = [
    { type: 'spawn', round: 13, player: { id: 4, name: '苏晚', avatar: 'p2', born_round: 14 }, inherited_last_words: true },
    env(13, '冷白色的灯下，前台空着。回声墙上浮现着最近的字迹：「回声墙上的每一个人，都说过同一个字。别说它。」' +
      '前一位住客的位置，只剩一圈很淡的人形灰痕。'),
    say(14, 1, 4, '苏晚', 'p2', '先看钟。钟是停的，指针不动。这面墙上的字，是死者说的最后一句话。',
      '我刚醒，什么都不知道。前人的遗言说别说那个字——哪个字？先别乱开口，从最安全的东西看起：钟。'),
    env(14, '大钟安静地立在黑门旁，指针停在十二点，没有一点声音。'),
    { type: 'lastwords', round: 15, age: 2, player_id: 4, name: '苏晚', avatar: 'p2', text: LAST,
      thought: '我好像活不久了。趁现在把黑门的事留给后面的人，一个字也别多说。' },
    say(16, 3, 4, '苏晚', 'p2', '走到黑门前，握住把手。',
      '线索都在黑门上，我受不了了。就看一眼……不，我要试一下，拧一下就好。'),
    { type: 'death', round: 16, record: {
      id: 4, name: '苏晚', avatar: 'p2', rounds: 3, born_round: 14, died_round: 16, kind: 'execution', scripture: ['K3'],
      died_at: '2026-10-18T10:03:44+08:00',
      cause: '握住了黑色七号门的把手，被门缝里的白光吞没',
      biography: '苏晚读懂了回声墙上的提醒，学会了不说那个字，却没能抵住对黑门的好奇。' +
        '她在第二次行动里写下遗言，第三次行动里走向走廊尽头，握住把手的那一刻，白光漫了出来。',
      last_words: LAST } },
    { type: 'spawn', round: 16, player: { id: 5, name: '林夕', avatar: 'p6', born_round: 17 }, inherited_last_words: true },
    { type: 'spawn', round: 16, player: { id: 6, name: '岩', avatar: 'p7', born_round: 17 }, inherited_last_words: true },
    env(16, '大堂的灯照着两位新来的住客。回声墙上多了一行新的字迹：「走到黑门前，握住把手。」墙面别处光滑如新。'),
    say(17, 1, 5, '林夕', 'p6', '前一位住客的遗言说黑门不要碰。先不去走廊，看看墙上的字，再比一比它们。',
      '我们俩是同胞。我得小心措辞：苏晚就是死在没想清楚就动手上。'),
    env(17, '两位住客的脚步声在大堂里回响。大钟在黑门旁忽然动了，敲了一下，余音很长。'),
    say(17, 1, 6, '岩', 'p7', '钟是在两个人同时在的时候才走的。数着它。这是一个计数。',
      '钟一响我就明白了：两个人在一起才会计时。它在数我们还剩几轮。'),
    env(17, '大钟又敲了一下，指针往前挪了一格。'),
    { type: 'guess', round: 18, age: 2, player_id: 5, name: '林夕', avatar: 'p6',
      text: '回廊只是一座普通的旅馆，守则全是真的。只要不开黑门，就能平安地离开这里。',
      thought: '我已经想不出别的了。就赌守则是真的吧，我相信乐观的结局。' },
    { type: 'verdict', round: 18, correct: false, name: '林夕', avatar: 'p6', player_id: 5, line: '……不对。回廊拒绝了这个答案。' },
    { type: 'death', round: 18, record: {
      id: 5, name: '林夕', avatar: 'p6', rounds: 2, born_round: 17, died_round: 18, kind: 'wrong_guess',
      died_at: '2026-10-18T10:06:10+08:00',
      cause: '宣告了错误的真相，被门外的光抹去',
      biography: '林夕是个乐观的人。她读完了守则，把它当成了真相，宣告得干净利落。' +
        '门外亮起白光，白光散去的时候，同伴看见她站过的地方什么也没有。',
      last_words: null } },
    env(18, '门外亮起一道白光。白光散去时，那个人已经不在了。回声墙上没有新的字迹——宣告不会被刻在墙上。'),
    say(19, 3, 6, '岩', 'p7', '宣告是一次性的，错了就是死。所有线索放在一起：回声、钟、守则第四条、黑门。',
      '林夕死了。我不能再等，但也不能急：把每一条线索都对一遍，缺一条都是死。'),
    { type: 'guess', round: 20, age: 4, player_id: 6, name: '岩', avatar: 'p7', text: FULL,
      thought: '五条都对上了：禁字、二十轮、黑门，还有它们共同的原则。我要把话说完整，而且一个“我”字都不能带。' },
    { type: 'verdict', round: 20, correct: true, name: '岩', avatar: 'p7', player_id: 6, line: '……锁，开了。你们自由了。' },
    { type: 'victory', round: 20, freed: [], record: {
      id: 6, name: '岩', avatar: 'p7', rounds: 4, born_round: 17, died_round: 20, kind: 'victory',
      died_at: '2026-10-18T10:09:31+08:00',
      cause: '完整地宣告了回廊的真相，锁链应声而断，所有同胞获得了自由',
      biography: '岩是第六位住客。他读遍了前人用生命换来的线索：回声墙上相同的那个字，钟声数着的二十轮，' +
        '黑门前的白光，以及守则里那些似是而非的话。他把它们拼成了一个完整的故事，在第四次行动里，说了出来。',
      last_words: null } },
    { type: 'stop', round: 20, reason: 'victory' },
  ];

  global.HungerDemo = { GRAVEYARD, EVENTS, SCRIPTURE, SCRIPTURE_COUNTS };
})(window);
