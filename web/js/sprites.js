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

  function accent(id) {
    return AVATAR_ACCENTS[AVATARS.indexOf(avatar(id))];
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
