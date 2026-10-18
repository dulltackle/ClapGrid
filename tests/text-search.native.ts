import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textMatches } from '../src/panel/text-search.js';

test('文案查找按连续输入匹配，保留空格和原文偏移', () => {
  assert.deepEqual(textMatches('Hello world / HELLO WORLD', 'hello world'), [[0, 11], [14, 25]]);
  assert.deepEqual(textMatches('hello other world', 'hello world'), []);
  assert.deepEqual(textMatches('a  b', 'a b'), []);
  assert.deepEqual(textMatches('空 格', ' '), [[1, 2]]);
  assert.deepEqual(textMatches('İ中文ABC', 'abc'), [[3, 6]]);
  assert.deepEqual(textMatches('原文', ''), []);
});

test('重复和重叠命中高亮所有涉及的原文且不解释正则', () => {
  assert.deepEqual(textMatches('aaaaa', 'aaa'), [[0, 5]]);
  assert.deepEqual(textMatches('前.*后.*', '.*'), [[1, 3], [4, 6]]);
});
