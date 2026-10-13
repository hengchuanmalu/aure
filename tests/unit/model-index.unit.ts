import { describe,expect,it } from 'vitest';
import { modelInitial } from "../../src/domain/model-index";
describe('name index', () => {
  it('indexes Latin, normalized letters, Chinese names and the other bucket', () => {
    for (const [name, initial] of [['Alice', 'A'], [' éva ', 'E'], ['Ｓｅｙａ', 'S'], ['阿包', 'A'], ['八重', 'B'], ['巴巴', 'B'], ['布丁大法', 'B'], ['林夏', 'L'], ['王小明', 'W'], ['西西', 'X'], ['张三', 'Z'], ['123', '#'], ['', '#'], ['かな', '#']]) expect(modelInitial(name)).toBe(initial);
  });
});
