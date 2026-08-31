import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSidebarWidth, clampSidebarTabsHeight, defaultSidebarWidth, defaultSidebarTabsHeight } from './layout.ts';

test('侧栏尺寸：空值和脏值回落到默认值', () => {
  // localStorage.getItem 返回 null 时 Number(null) 是 0，必须落回默认宽度而不是 0 宽侧栏
  assert.equal(clampSidebarWidth(Number(null)), defaultSidebarWidth);
  assert.equal(clampSidebarWidth(Number('abc')), defaultSidebarWidth);
  assert.equal(clampSidebarWidth(-40), defaultSidebarWidth);
  assert.equal(clampSidebarTabsHeight(Number(null)), defaultSidebarTabsHeight);
  assert.equal(clampSidebarTabsHeight(Number('')), defaultSidebarTabsHeight);
});

test('侧栏尺寸：拖出范围的值被夹回区间', () => {
  assert.equal(clampSidebarWidth(20), 180);
  assert.equal(clampSidebarWidth(4000), 560);
  assert.equal(clampSidebarWidth(321.4), 321);
  assert.equal(clampSidebarTabsHeight(10), 84);
  assert.equal(clampSidebarTabsHeight(9999), 520);
  assert.equal(clampSidebarTabsHeight(200), 200);
});
