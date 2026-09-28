import assert from 'node:assert/strict';
import { test } from 'node:test';

import ts from 'typescript';

import { checkSource, documentedDeclarations } from './check-api-tsdoc.mjs';

function source(text) {
  return ts.createSourceFile('example.ts', text, ts.ScriptTarget.Latest, true);
}

test('checks private methods, accessors, constructors, arrows, and method contracts', () => {
  const input = source(`
    class Example {
      constructor(value: string) {}
      private run(value: string) {}
      get current() { return 1; }
      set current(value: number) {}
      runArrow = (value: string) => value;
    }
    interface Contract { run(value: string): void; }
    const helper = (value: string) => value;
    const helpers = { map: (value: string) => value };
  `);
  assert.equal(documentedDeclarations(input).length, 8);
  assert.equal(checkSource(input).filter((error) => error.includes('summary')).length, 8);
});

test('ignores anonymous callbacks and accepts complete generic documentation', () => {
  const input = source(`
    /** Map a value.
     * @typeParam T - Value type.
     * @param value - Value to return.
     * @returns The supplied value.
     */
    function identity<T>(value: T): T { return value; }
    [1].map((value) => value + 1);
    register({ callback: () => 1 });
  `);
  assert.equal(documentedDeclarations(input).length, 1);
  assert.deepEqual(checkSource(input), []);
});

test('detects stale, empty, and missing signature tags', () => {
  const errors = checkSource(
    source(`
    /** Return a value.
     * @param oldName - Stale parameter name.
     * @returns
     */
    function identity<T>(value: T): T { return value; }
  `),
  );
  assert.equal(errors.length, 3);
});

test('does not require return tags for constructors or setters', () => {
  assert.deepEqual(
    checkSource(
      source(`
    class Example {
      /** Initialize state. @param value - Initial value. */
      constructor(value: string) {}
      /** Replace state. @param value - New value. */
      set current(value: string) {}
    }
  `),
    ),
    [],
  );
});

test('requires throws documentation for escaping errors but not handled failures', () => {
  const undocumented = source(`
    /** Validate input. @returns No return value. */
    function validate() { throw new Error('Invalid input.'); }
  `);
  assert.match(checkSource(undocumented)[0], /@throws/);
  const handled = source(`
    /** Use a fallback. @returns The fallback value. */
    function fallback() { try { throw new Error('Missing value.'); } catch { return null; } }
  `);
  assert.deepEqual(checkSource(handled), []);
});
