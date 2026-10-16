import nativeTest from 'node:test';
import type { TestContext } from 'node:test';

export function declarations() {
  const cases: Array<[string, (t: TestContext) => unknown]> = [];
  return {
    test(name: string, body: (t: TestContext) => unknown) { cases.push([name, body]); },
    register() {
      const ordered = [...cases];
      if (process.env.RIFARE_TEST_ORDER === 'reverse') ordered.reverse();
      for (const [name, body] of ordered) nativeTest(name, body);
    },
  };
}
