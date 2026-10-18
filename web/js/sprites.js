/* 像素图：用文本位图定义，渲染成 SVG（每个字符一个像素，"." 为透明）。
 * 想改图标/头像，直接改下面的字符画即可。 */
(function (global) {
  'use strict';

  // Sweetie-16 调色板
  const PALETTE = {
    k: '#1a1c2c', // 黑（描边）
    w: '#f4f4f4', // 白
    y: '#ffcd75', // 金
    o: '#ef7d57', // 橙
    r: '#b13e53', // 红
    b: '#41a6f6', // 亮蓝
    d: '#3b5dc9', // 深蓝
    g: '#38b764', // 绿
    c: '#73eff7', // 青
    p: '#5d275d', // 紫
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

  const SPRITES = {
    // —— 头像 ——
    eye: [ // 环境 / 旁白
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
    robotA: recolor(ROBOT_A, { F: 'b', D: 'd', A: 'y' }),
    robotB: recolor(ROBOT_B, { F: 'o', D: 'r', A: 'g' }),

    // —— 菜单图标 ——
    globe: [
      '....kkkk....',
      '..kkbbggkk..',
      '.kbbgggbbbk.',
      '.kbgggbbbbk.',
      'kbbggbbbgbbk',
      'kbbbbbgggbbk',
      'kbbbbbggggbk',
      'kbggbbbgggbk',
      '.kbgggbbbgk.',
      '.kbbggbbbbk.',
      '..kkbbbbkk..',
      '....kkkk....',
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
    person: [
      '....kkkk....',
      '...kyyyyk...',
      '..kyyyyyyk..',
      '..kykyykyk..',
      '..kyyyyyyk..',
      '...kyyyyk...',
      '....kkkk....',
      '..kkkkkkkk..',
      '.kddddddddk.',
      '.kddddddddk.',
      '.kddddddddk.',
      '.kkkkkkkkkk.',
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
  };

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

  global.Sprites = { svg, mount, SPRITES, PALETTE };
})(window);
