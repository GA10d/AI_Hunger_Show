/* 演示数据：没有连上后端时（比如直接双击打开 index.html）用它播放一段完整的流程：
 * 入场 → 对话 → 留下遗言 → 死亡 → 同时出生两位选手，带着遗言入场并同场互动。
 * 格式和后端推送的事件完全一致。 */
(function (global) {
  'use strict';

  const GRAVEYARD = [
    {
      id: 1, name: '格雷', avatar: 'p1', rounds: 31, born_round: 1, died_round: 31,
      died_at: '2026-10-17T21:40:12+08:00',
      cause: '在断粮的第三天倒在了空荡荡的食堂门口',
      biography: '格雷是第一个走进食堂的人。他相信只要把每张桌子都擦干净，饭菜就会自己出现，于是擦了整整三十一轮。' +
        '他发现了墙上的数字，也发现了每一扇门后都没有厨房。最后他坐在门槛上，把抹布叠得整整齐齐，再也没有站起来。',
      last_words: '汤是凉的，别信第三扇门。',
    },
    {
      id: 2, name: '雷诺', avatar: 'p4', rounds: 8, born_round: 32, died_round: 39,
      died_at: '2026-10-17T22:05:51+08:00',
      cause: '误触了会发光的按钮，被白光吞没',
      biography: '雷诺性子急，进来的第一件事就是找开关。他在第七次行动时按下了墙角那枚会发光的按钮，' +
        '白光从天花板落下来的时候，他还在问环境这是不是出口。',
      last_words: null,
    },
    {
      id: 3, name: '沃维尔', avatar: 'p5', rounds: 56, born_round: 40, died_round: 95,
      died_at: '2026-10-18T09:12:30+08:00',
      cause: '守着最后一盏灯，直到灯油与生命一同燃尽',
      biography: '沃维尔是活得最久的人之一。他不和环境争辩，只做一件事：守灯。' +
        '他把前人的遗言抄在墙上，把每一轮发生的事都记在灯下。第九十五轮，灯油见底，他把最后一页纸压在灯座下，闭上了眼。',
      last_words: '热气会骗人。别信第二扇门，勺子声是诱饵。',
    },
  ];

  const LAST = '给后来的人：别信勺子声，热气是往第三扇门去的。我先走一步。';

  const env = (round, text) => ({ type: 'message', who: 'env', name: '环境', avatar: null, round, text });
  const say = (round, age, id, name, avatar, text) =>
    ({ type: 'message', who: 'player', name, avatar, round, age, player_id: id, text });

  const EVENTS = [
    { type: 'spawn', round: 95, player: { id: 4, name: '阿烬', avatar: 'p2', born_round: 96 }, inherited_last_words: true },
    env(95, '你站在一座漂浮在云上的食堂门口。三扇门，只有第二扇透着汤的热气。门框上刻着一行小字：先到的人，请把话留给后来的人。'),
    say(96, 1, 4, '阿烬', 'p2', '我先不进门，蹲下来看门缝里的热气往哪边飘。'),
    env(96, '热气贴着地面绕了一圈，钻进第三扇门的缝里。第二扇门后，传来勺子碰碗的声音，一下，又一下。'),
    { type: 'lastwords', round: 97, age: 2, player_id: 4, name: '阿烬', avatar: 'p2', text: LAST },
    { type: 'death', round: 97, record: {
      id: 4, name: '阿烬', avatar: 'p2', rounds: 2, born_round: 96, died_round: 97,
      died_at: '2026-10-18T10:03:44+08:00',
      cause: '循着勺子声推开第二扇门，坠入了没有底的食堂',
      biography: '阿烬第四个来到这里。他谨慎，先蹲在门缝前观察热气的走向，推断出第三扇门才是真路，' +
        '却在第二次行动时用掉了他仅有的机会，把发现写成了遗言。他没能亲眼验证，门后的勺子声就把他带走了。',
      last_words: LAST } },
    { type: 'spawn', round: 97, player: { id: 5, name: '白露', avatar: 'p6', born_round: 98 }, inherited_last_words: true },
    { type: 'spawn', round: 97, player: { id: 6, name: '岩', avatar: 'p7', born_round: 98 }, inherited_last_words: true },
    env(97, '云上的食堂还是老样子，三扇门，两扇静默，一扇透着热气。地上有人用手指划过的浅痕，通向第三扇门。白露和岩几乎同时睁开了眼。'),
    say(98, 1, 5, '白露', 'p6', '我记下了那句遗言。绕开第二扇门，我去敲第三扇——你呢？'),
    env(98, '白露的指节落在第三扇门上，门里很安静，随后传来一声很轻的、像是有人在等她的叹息。'),
    say(98, 1, 6, '岩', 'p7', '我跟你一起，但你先敲。我守着第二扇门的方向，勺子声要是再响，我第一个告诉你。'),
    env(98, '岩刚站定，第二扇门后的勺子声果然又响了，这一次，节奏和白露的心跳一模一样。'),
  ];

  global.HungerDemo = { GRAVEYARD, EVENTS };
})(window);
