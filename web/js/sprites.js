/* 像素图：用文本位图定义，渲染成 SVG（每个字符一个像素，"." 为透明）。
 * 想改图标/头像，直接改下面的字符画即可。 */
(function (global) {
  'use strict';

  // Sweetie-16 调色板（外加一个木头棕 u）
  const PALETTE = {
    k: '#1a1c2c', // 黑（描边）
    w: '#f4f4f4', // 白
    y: '#ffcd75', // 金
    o: '#ef7d57', // 橙
    r: '#b13e53', // 红
    p: '#5d275d', // 紫
    d: '#3b5dc9', // 深蓝
    b: '#41a6f6', // 亮蓝
    c: '#73eff7', // 青
    g: '#38b764', // 绿
    l: '#a7f070', // 浅绿
    e: '#257179', // 深青绿
    m: '#94b0c2', // 浅灰
    s: '#566c86', // 灰
    n: '#333c57', // 石板
    u: '#8a5a3c', // 木头棕
    q: '#e8d5a3', // 羊皮纸
  };

  // 机器人头像模板：F 主色 / D 暗色 / A 点缀色，换色就能做出不同选手
  function recolor(rows, map) {
    return rows.map(row => row.replace(/[FDA]/g, ch => map[ch]));
  }

  const ROBOT_A = [
    '.....AA.....',
    '.....kk.....',
    '.kkkkkkkkkk.',
    '.kFFFFFFFFk.',
    'AkFwwFFwwFkA',
    'AkFwkFFwkFkA',
    '.kFFFFFFFFk.',
    '.kFFkkkkFFk.',
    '.kFFFFFFFFk.',
    '.kkkkkkkkkk.',
    '....kDDk....',
    '..kkDDDDkk..',
  ];

  const ROBOT_B = [
    '....A..A....',
    '....k..k....',
    '.kkkkkkkkkk.',
    '.kFFFFFFFFk.',
    'AkFwwFFwwFkA',
    'AkFwkFFwkFkA',
    '.kFFFFFFFFk.',
    '.kFFFFFkkFk.',
    '.kFFFFFFFFk.',
    '.kkkkkkkkkk.',
    '....kDDk....',
    '..kkDDDDkk..',
  ];

  // 选手头像 p0~p7（后端按 id 分配，必须和 game.py 里的 AVATARS 保持一致）
  const AVATAR_STYLES = [
    [ROBOT_A, { F: 'b', D: 'd', A: 'y' }],
    [ROBOT_B, { F: 'o', D: 'r', A: 'g' }],
    [ROBOT_A, { F: 'g', D: 'e', A: 'l' }],
    [ROBOT_B, { F: 'r', D: 'p', A: 'y' }],
    [ROBOT_A, { F: 'y', D: 'o', A: 'r' }],
    [ROBOT_B, { F: 'p', D: 'n', A: 'c' }],
    [ROBOT_A, { F: 'c', D: 'b', A: 'w' }],
    [ROBOT_B, { F: 'm', D: 's', A: 'o' }],
  ];

  const SPRITES = {
    // —— 环境头像 ——
    eye: [
      '............',
      '............',
      '...kkkkkk...',
      '..kwwwwwwk..',
      '.kwwwyywwwk.',
      'kwwwyykkwwwk',
      'kwwwyykkwwwk',
      '.kwwwyywwwk.',
      '..kwwwwwwk..',
      '...kkkkkk...',
      '............',
      '............',
    ],

    // —— 菜单图标 ——
    scroll: [ // 圣言：打开的卷轴，上下各卷着一个轴
      '..kkkkkkkk..',
      '.kyyyyyyyyk.',
      '..kkkkkkkk..',
      '..kqqqqqqk..',
      '..kquuuuqk..',
      '..kqqqqqqk..',
      '..kquuuuqk..',
      '..kqqqqqqk..',
      '..kquuuqqk..',
      '..kkkkkkkk..',
      '.kyyyyyyyyk.',
      '..kkkkkkkk..',
    ],
    note: [
      '...kkkkkkkk.',
      '...kyyyyyyk.',
      '...kyyyyyyk.',
      '...kykkkkyk.',
      '...kyk..kyk.',
      '...kyk..kyk.',
      '...kyk..kyk.',
      '...kyk..kyk.',
      '.kkkyk.kkyk.',
      'kyyyyk.kyyyk',
      'kyyyyk.kyyyk',
      '.kkkk..kkkk.',
    ],
    info: [ // 信息：蓝色圆牌上一个白色的 i
      '...kkkkkk...',
      '..kbbbbbbk..',
      '.kbbbwwbbbk.',
      'kbbbbwwbbbbk',
      'kbbbbbbbbbbk',
      'kbbbwwwbbbbk',
      'kbbbbwwbbbbk',
      'kbbbbwwbbbbk',
      'kbbbbwwbbbbk',
      '.kbbwwwwbbk.',
      '..kbbbbbbk..',
      '...kkkkkk...',
    ],
    coin: [
      '....kkkk....',
      '..kkyyyykk..',
      '.kyyyyyyyyk.',
      '.kyyyooyyyk.',
      'kyyyyooyyyyk',
      'kyyyyooyyyyk',
      'kyyyyooyyyyk',
      'kyyyyooyyyyk',
      '.kyyyooyyyk.',
      '.kyyyyyyyyk.',
      '..kkyyyykk..',
      '....kkkk....',
    ],

    // —— 墓园 ——
    tomb: [ // 石碑：留下了遗言的人
      '...kkkkkk...',
      '..kmmmmmmk..',
      '.kmmmmmmmmk.',
      '.kmmmkkmmmk.',
      '.kmmmkkmmmk.',
      '.kmkkkkkkmk.',
      '.kmmmkkmmmk.',
      '.kmmmkkmmmk.',
      '.kmmmmmmmmk.',
      '.kssssssssk.',
      'kkkkkkkkkkkk',
      '............',
    ],
    cross: [ // 木十字架：没来得及留下遗言的人
      '....kkkk....',
      '....kuuk....',
      '....kuuk....',
      '..kkkuukkk..',
      '..kuuuuuuk..',
      '..kuuuuuuk..',
      '..kkkuukkk..',
      '....kuuk....',
      '....kuuk....',
      '....kuuk....',
      '.kkkggggkkk.',
      '............',
    ],
    star: [ // 宣告 / 胜利
      '.....yy.....',
      '.....yy.....',
      '....yyyy....',
      '...yyyyyy...',
      'yyyyywwyyyyy',
      'yyywwwwwwyyy',
      'yyywwwwwwyyy',
      'yyyyywwyyyyy',
      '...yyyyyy...',
      '....yyyy....',
      '.....yy.....',
      '.....yy.....',
    ],
    lock: [ // 圣言里还没有被揭示的条目
      '....kkkk....',
      '...kmmmmk...',
      '..km....mk..',
      '..km....mk..',
      '.kkkkkkkkkk.',
      '.kyyyyyyyyk.',
      '.kyyykkyyyk.',
      '.kyyykkyyyk.',
      '.kyyykkyyyk.',
      '.kyyyyyyyyk.',
      '.kkkkkkkkkk.',
      '............',
    ],
    skull: [ // 死亡
      '............',
      '...kkkkkk...',
      '..kwwwwwwk..',
      '.kwwwwwwwwk.',
      '.kwkkwwkkwk.',
      '.kwkkwwkkwk.',
      '.kwwwkkwwwk.',
      '..kwwwwwwk..',
      '..kwkwkwkk..',
      '..kwkwkwkk..',
      '...kkkkkk...',
      '............',
    ],
    candle: [ // 遗言
      '.....yy.....',
      '....yoyy....',
      '....yooy....',
      '.....kk.....',
      '....kwwk....',
      '....kwwk....',
      '....kwwk....',
      '....kwwk....',
      '....kwwk....',
      '..kkkkkkkk..',
      '..kmmmmmmk..',
      '..kkkkkkkk..',
    ],
    heart: [ // 在世
      '............',
      '..kkk..kkk..',
      '.krrrkkrrrk.',
      '.krwrrrrrrk.',
      '.krrrrrrrrk.',
      '.krrrrrrrrk.',
      '..krrrrrrk..',
      '...krrrrk...',
      '....krrk....',
      '.....kk.....',
      '............',
      '............',
    ],

    // —— 猫娘：她自己的头像（和机器人头像同样的版式：第 3 行是主色、第 4 行最左是点缀色、第 10 行是衣服色，
    //    眼睛、嘴巴的位置也一样，演出区才能给她做表情） ——
    cat: [
      '.k........k.',
      'krk......krk',
      'krrkkkkkkrrk',
      '.kooooooook.',
      'wkowwoowwokw',
      'wkowkoowkokw',
      '.kooorroook.',
      '.kookookook.',
      '.koookkoook.',
      '.kkkkkkkkkk.',
      '....kppk....',
      '..kkppppkk..',
    ],
    // —— 其他稀有身份的头像（同样的版式） ——
    bard: [ // 吟游诗人：插着羽毛的红色贝雷帽
      '........yk..',
      '..kkkkkkykk.',
      '.krrrrrrrrrk',
      '.kqqqqqqqqk.',
      'ykqwwqqwwqky',
      'ykqwkqqwkqky',
      '.kqqqqqqqqk.',
      '.kqqkkkkqqk.',
      '.kqqqqqqqqk.',
      '.kkkkkkkkkk.',
      '....krrk....',
      '..kkrrrrkk..',
    ],
    gambler: [ // 赌徒：荷官的绿色遮阳帽檐，嘴角一歪
      '............',
      '.kkkkkkkkkk.',
      'kggggggggggk',
      '.kmmmmmmmmk.',
      'rkmwwmmwwmkr',
      'rkmwkmmwkmkr',
      '.kmmmmmmmmk.',
      '.kmmmmmkkmk.',
      '.kmmmmmmmmk.',
      '.kkkkkkkkkk.',
      '....kggk....',
      '..kkggggkk..',
    ],
    medium: [ // 通灵者：紫色兜帽，额头上一只青色的第三只眼
      '....kkkk....',
      '..kkppppkk..',
      '.kppppppppk.',
      'kpkmmccmmkpk',
      'pkmwwmmwwmkp',
      'pkmwkmmwkmkp',
      'pkmmmmmmmmkp',
      'pkmmkkkkmmkp',
      '.kmmmmmmmmk.',
      '.kkkkkkkkkk.',
      '....kppk....',
      '..kkppppkk..',
    ],
    believer: [ // 信徒：棕色修士兜帽，双眼闭着祷告
      '...kkkkkk...',
      '..kuuuuuuk..',
      '.kuuuuuuuuk.',
      'kukqqqqqqkuk',
      'ukqqqqqqqqku',
      'ukqkkqqkkqku',
      'ukqqqqqqqqku',
      'ukqqqkkqqqku',
      '.kqqqqqqqqk.',
      '.kkkkkkkkkk.',
      '....kwwk....',
      '..kkwwwwkk..',
    ],
    earthbound: [ // 地缚灵体质：青白的脸、缝起来的嘴，头顶两节锁链
      '...k....k...',
      '..ksk..ksk..',
      '.kkkkkkkkkk.',
      '.kcccccccck.',
      'skcwwccwwcks',
      'skcwkccwkcks',
      '.kcccccccck.',
      '.kckckkckck.',
      '.kcccccccck.',
      '.kkkkkkkkkk.',
      '....knnk....',
      '..kknnnnkk..',
    ],
    earthboundGhost: [ // 地缚灵死后灵体化：眼睛变成 × ×（对话区里低语的头像）
      '...k....k...',
      '..ksk..ksk..',
      '.kkkkkkkkkk.',
      '.kkckcckckk.',
      'skckcccckcks',
      'skkckcckckks',
      '.kcccccccck.',
      '.kckckkckck.',
      '.kcccccccck.',
      '.kkkkkkkkkk.',
      '....knnk....',
      '..kknnnnkk..',
    ],
    chronicler: [ // 史官：两边带翅的黑色乌纱帽，深蓝官袍
      '...kkkkkk...',
      'kk.knnnnk.kk',
      'kkkknnnnkkkk',
      '.kqqqqqqqqk.',
      'ykqwwqqwwqky',
      'ykqwkqqwkqky',
      '.kqqqqqqqqk.',
      '.kqqkkkkqqk.',
      '.kqqqqqqqqk.',
      '.kkkkkkkkkk.',
      '....kddk....',
      '..kkddddkk..',
    ],
    dagger: [ // 下杀手：一把带血的匕首
      '..........kk',
      '.........kwk',
      '........kwmk',
      '.......kwmk.',
      '......kwmk..',
      '.....kwmk...',
      '..k.kwmk....',
      '..kkrmk.....',
      '...krrk.....',
      '..kurkk.....',
      '.kuuk.......',
      '.kkk........',
    ],
    lily: [ // 诀别：一朵白色的花
      '.....kk.....',
      '....kwwk....',
      '.kk.kwwk.kk.',
      'kwwkkwwkkwwk',
      'kwwwwyywwwwk',
      '.kwwwyywwwk.',
      '..kkwwwwkk..',
      '....kkkk....',
      '.....kg.....',
      '....kgk.....',
      '.kk.kg......',
      '.kgkg.......',
    ],
    dice: [ // 赌徒的骰子
      '.kkkkkkk.',
      'kwwwwwwwk',
      'kwkwwwkwk',
      'kwwwwwwwk',
      'kwwwrwwwk',
      'kwwwwwwwk',
      'kwkwwwkwk',
      'kwwwwwwwk',
      '.kkkkkkk.',
    ],
    chain: [ // 地缚灵的锁链
      '.mmm..mmm.',
      'm...mm...m',
      'm...mm...m',
      '.mmm..mmm.',
    ],
    paw: [ // 猫爪印
      '.kk..kk.',
      'krrkkrrk',
      '.kk..kk.',
      '........',
      '.kkrrkk.',
      'krrrrrrk',
      'krrrrrrk',
      '.kkkkkk.',
    ],

    // —— 复活的人：天使的翅膀（左边那只，右边的镜像翻转）、发言框角上的小十字架 ——
    wing: [
      '.........kk.',
      '.......kkwwk',
      '.....kkwwwwk',
      '...kkwwwmwwk',
      '..kwwwwmwwwk',
      '.kwwwmwwwwwk',
      'kwwwmwwwwmwk',
      '.kwmwwwwmwk.',
      '..kwwwmwwk..',
      '...kwmwwk...',
      '....kwwk....',
      '.....kk.....',
    ],
    holyCross: [
      '..kkk..',
      '..kyk..',
      'kkkykkk',
      'kyyyyyk',
      'kkkykkk',
      '..kyk..',
      '..kyk..',
      '..kyk..',
      '..kkk..',
    ],

    // —— 观众投票 ——
    thumbUp: [ // 👍
      '.....kk.....',
      '....kyyk....',
      '....kyyk....',
      '...kyyk.....',
      '.kkkyykkkkk.',
      'kdkyyyyyyyyk',
      'kdkyyyyyykk.',
      'kdkyyyyyyyyk',
      'kdkyyyyyykk.',
      'kdkyyyyyyyk.',
      '.kkkkkkkkk..',
      '............',
    ],
    thumbDown: [ // 👎
      '............',
      '.kkkkkkkkk..',
      'krkmmmmmmmk.',
      'krkmmmmmmkk.',
      'krkmmmmmmmmk',
      'krkmmmmmmkk.',
      'krkmmmmmmmmk',
      '.kkkmmkkkkk.',
      '...kmmk.....',
      '....kmmk....',
      '....kmmk....',
      '.....kk.....',
    ],
    crown: [ // 人气之星：金冠
      '............',
      '.y...y....y.',
      'kyk.kyk..kyk',
      'kyykyyykkyyk',
      'kyyyyyyyyyyk',
      'kyyryyyyyryk',
      'kyrrryybrrrk',
      'kyyryyyyyryk',
      'kyyyyyyyyyyk',
      'kooooooooook',
      '.kkkkkkkkkk.',
      '............',
    ],
    stormcloud: [ // 众矢之的：头顶一朵带闪电的乌云
      '...kkkk.....',
      '..knnnnkkk..',
      '.knsnnnnnnk.',
      'knnnnsnnnnnk',
      'knnnnnnnnnnk',
      '.kkkkykkkkk.',
      '....yy......',
      '...yy..c..c.',
      '....yy......',
      '.....y.c..c.',
      '............',
      '............',
    ],
    tomato: [ // 扔来的烂番茄
      '.....gg.....',
      '....kggk....',
      '..kkrrrrkk..',
      '.krrwrrrrrk.',
      '.krwrrrrrrk.',
      'krrrrrrrrrrk',
      'krrrrrrrrrrk',
      'krrrrrrrrprk',
      '.krrrrrrppk.',
      '.krrrrpppk..',
      '..kkkkkkk...',
      '............',
    ],
    cone: [ // 维修中：路障锥
      '.....kk.....',
      '....kook....',
      '....kook....',
      '...kwwwwk...',
      '...kwwwwk...',
      '..kooooook..',
      '..kooooook..',
      '.kwwwwwwwwk.',
      '.kwwwwwwwwk.',
      '.koooooooook',
      'kkkkkkkkkkkk',
      'knnnnnnnnnnk',
    ],
  };

  const AVATARS = AVATAR_STYLES.map(([tpl, map], i) => {
    SPRITES['p' + i] = recolor(tpl, map);
    return 'p' + i;
  });

  // 每个头像对应一个醒目的主色，用来区分同场的两位选手（气泡名字、头像边框都用它）
  const AVATAR_ACCENTS = ['#41a6f6', '#ef7d57', '#a7f070', '#e0607a', '#ffcd75', '#c28cd9', '#73eff7', '#94b0c2'];

  // 后端可能给出不认识的头像 id，回退到 p0
  function avatar(id) {
    return SPRITES[id] ? id : 'p0';
  }

  // 稀有身份的专属头像不在随机分配的 p0~p7 里，各有各的主色
  const SPECIAL_ACCENTS = {
    cat: '#f7a8d0', bard: '#e0607a', gambler: '#38b764', medium: '#c28cd9', believer: '#e8d5a3', earthbound: '#73eff7',
    chronicler: '#e8c170',
  };

  function accent(id) {
    return SPECIAL_ACCENTS[id] || AVATAR_ACCENTS[AVATARS.indexOf(avatar(id))];
  }

  function svg(name) {
    const rows = SPRITES[name];
    if (!rows) { console.warn('[sprites] unknown sprite:', name); return ''; }
    const w = rows[0].length;
    let rects = '';
    rows.forEach((row, y) => {
      if (row.length !== w) console.warn(`[sprites] ${name} row ${y} has width ${row.length}, expected ${w}`);
      for (let x = 0; x < row.length;) {
        const ch = row[x];
        let run = 1;
        while (x + run < row.length && row[x + run] === ch) run++;
        if (ch !== '.') {
          if (PALETTE[ch]) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[ch]}"/>`;
          else console.warn(`[sprites] ${name} row ${y}: unknown color "${ch}"`);
        }
        x += run;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // 把 root 下所有 [data-sprite] 元素填上对应的像素图
  function mount(root) {
    (root || document).querySelectorAll('[data-sprite]').forEach(el => { el.innerHTML = svg(el.dataset.sprite); });
  }

  global.Sprites = { svg, mount, avatar, accent, AVATARS, SPRITES, PALETTE };
})(window);
