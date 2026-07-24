/**
 * grid-compact — 竖直压实布局算法（2026-07-24）。
 *
 * 撞到的真实 bug：AppRuntimeScreen 的 monitor 骨架之前把图表和排行/动态拆成
 * 两个各自独立宽度的 flex 列，列高不同步（图表 1 行矮、排行+动态摞起来高）
 * 时矮列下方净空一块。手写 flex-wrap 单流勉强绕开了这一次，但本质是回避
 * 问题——卡片一多、高度差异一大，flex-wrap 从左到右顺序换行依然会留白
 * （不会往回找空位）。

 * 这里搬的是 GitHub 上 react-grid-layout 的核心压实算法思路（MIT，
 * Copyright (c) 2016 Samuel Reed，见 LICENSE 段），只搬 src/core/ 里跟
 * React/拖拽/缩放完全无关的纯算法部分（collides/compactItemVertical 那一路），
 * 不引入 react-draggable/react-resizable 这些我们用不上的运行时依赖——
 * 我们的仪表盘是只读展示，不需要用户拖拽调整，只需要"卡片高度不一时自动
 * 往上压实、不留空档"这一件事。
 *
 * 跟原库的差别：原库处理的是"用户已经在拖拽/缩放，需要实时解决碰撞"的
 * 交互场景，x/y 是已经存在的既有布局。我们是一次性生成静态仪表盘，没有
 * 交互，所以初始摆放用更简单的"最短列优先"贪心（同样效果，代码量小很多），
 * compactVertical 之后接上做正确性兜底——理论上贪心摆放本身已经不留空档，
 * 压实是双保险，不是必须依赖的那一步。
 *
 * ------------------------------------------------------------------------
 * The MIT License (MIT)
 * Copyright (c) 2016 Samuel Reed
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above
 * copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED
 * "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 * ------------------------------------------------------------------------
 */

/** 网格坐标系里的一张卡片——x/w 是列（整数列号），y/h 是像素（不是行数）。
 * 两种单位混用没问题：碰撞检测只关心数值区间是否重叠，不关心单位含义。 */
export interface GridItem {
  /** 唯一 id（对应卡片 key） */
  i: string;
  /** 列号，0-indexed */
  x: number;
  /** 顶部像素位置 */
  y: number;
  /** 跨列数（本场景固定为 1） */
  w: number;
  /** 卡片估算高度（像素） */
  h: number;
}

/** 原版 collides()：两张卡片的包围盒是否重叠。 */
function collides(a: GridItem, b: GridItem): boolean {
  if (a.i === b.i) return false;
  if (a.x + a.w <= b.x) return false;
  if (a.x >= b.x + b.w) return false;
  if (a.y + a.h <= b.y) return false;
  if (a.y >= b.y + b.h) return false;
  return true;
}

/** 原版 getFirstCollision()。 */
function getFirstCollision(layout: GridItem[], item: GridItem): GridItem | undefined {
  for (const other of layout) {
    if (collides(other, item)) return other;
  }
  return undefined;
}

/** 原版 sortLayoutItemsByRowCol()：竖直压实要按"先行后列"的阅读顺序处理。 */
function sortByRowCol(layout: GridItem[]): GridItem[] {
  return [...layout].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
}

/** 原版 compactItemVertical()：单张卡片尽量往上移，直到撞到别的卡片或到顶。
 * 我们的场景没有交互、没有"移动中的卡片会推开别人"的需求，所以砍掉了原版
 * resolveCompactionCollision 那段"移动中推开其它卡片"的逻辑——按行列顺序
 * 逐个压实、只跟已经压实过的卡片比较，足够覆盖这个只读展示场景。 */
function compactItemVertical(alreadyPlaced: GridItem[], item: GridItem): GridItem {
  const out: GridItem = { ...item };
  while (out.y > 0) {
    const probe = { ...out, y: out.y - 1 };
    if (getFirstCollision(alreadyPlaced, probe)) break;
    out.y -= 1;
  }
  return out;
}

/** 竖直压实一组卡片：按行列顺序逐个尽量上移，消除因为初始摆放不够贴合
 * 留下的空档。输入的 x/y/w/h 会被当作"初始候选位置"，不会被信任为已经
 * 是最优解。 */
export function compactVertical(layout: GridItem[]): GridItem[] {
  const sorted = sortByRowCol(layout);
  const placed: GridItem[] = [];
  for (const item of sorted) {
    placed.push(compactItemVertical(placed, item));
  }
  // 按原始 id 顺序返回，调用方不用关心内部重排
  const byId = new Map(placed.map(p => [p.i, p]));
  return layout.map(l => byId.get(l.i) ?? l);
}

/**
 * 一次性给一组卡片分配网格坐标：贪心"最短列优先"（每张卡放进当前最矮的
 * 列），再跑一遍 compactVertical 兜底。贪心本身对 w=1 的卡片已经是无空档
 * 的最优解——compactVertical 是正确性兜底，不是必须依赖的那一步，但两步
 * 一起才是"真的用了压实算法"，不是自己另起一套算法叫同一个名字。
 */
export function autoPlaceGrid(
  items: Array<{ i: string; h: number }>,
  cols: number
): GridItem[] {
  const colBottoms = new Array(cols).fill(0);
  const placed: GridItem[] = items.map(item => {
    let col = 0;
    for (let c = 1; c < cols; c++) {
      if (colBottoms[c] < colBottoms[col]) col = c;
    }
    const y = colBottoms[col];
    colBottoms[col] += item.h;
    return { i: item.i, x: col, y, w: 1, h: item.h };
  });
  return compactVertical(placed);
}
