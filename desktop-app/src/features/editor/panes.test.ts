import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPane, panes } from './panes.ts';

test('分栏尺寸：空值和脏值回落到默认值', () => {
  // localStorage.getItem 返回 null 时 Number(null) 是 0，必须落回默认宽度而不是 0 宽
  assert.equal(clampPane('appSidebar', Number(null)), panes.appSidebar.fallback);
  assert.equal(clampPane('projectAgent', Number('abc')), panes.projectAgent.fallback);
  assert.equal(clampPane('libraryList', -80), panes.libraryList.fallback);
});

test('分栏尺寸：拖出范围的值被夹回各自区间', () => {
  for (const name of Object.keys(panes) as Array<keyof typeof panes>) {
    const spec = panes[name];
    assert.equal(clampPane(name, spec.min - 50), spec.min, `${name} 下界`);
    assert.equal(clampPane(name, spec.max + 500), spec.max, `${name} 上界`);
    assert.ok(spec.min <= spec.fallback && spec.fallback <= spec.max, `${name} 默认值应落在区间内`);
  }
  assert.equal(clampPane('appSidebar', 240.6), 241);
});
