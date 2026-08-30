import { describe, expect, test } from 'bun:test';
import { mergeLastVersion, getLastVersionForTarget } from '../src/frontmatter/handler';
import type { NoteBinding } from '../src/types';

describe('mergeLastVersion', () => {
	test('merges a delta into an empty map', () => {
		expect(mergeLastVersion(undefined, { a: { '111': 3 } })).toEqual({ a: { '111': 3 } });
	});

	test('preserves foreign instance slices and updates own pageIds', () => {
		const existing = { a: { '111': 2 }, b: { '222': 9 } };
		const result = mergeLastVersion(existing, { a: { '111': 4, '333': 1 } });
		expect(result).toEqual({ a: { '111': 4, '333': 1 }, b: { '222': 9 } });
	});

	test('accepts numeric strings from YAML', () => {
		const existing = { a: { '111': '5' } };
		expect(mergeLastVersion(existing, { a: { '111': 6 } })).toEqual({ a: { '111': 6 } });
	});

	test('ignores reserved prototype keys', () => {
		const existing = JSON.parse('{"a":{"111":2},"__proto__":{"999":1},"constructor":{"888":1}}');
		const delta = JSON.parse('{"a":{"111":3,"prototype":7},"__proto__":{"777":1}}') as Record<string, Record<string, number>>;
		const result = mergeLastVersion(existing, delta);
		expect(result).toEqual({ a: { '111': 3 } });
		expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result.a, 'prototype')).toBe(false);
	});
});

describe('getLastVersionForTarget', () => {
	test('reads the nested version or returns undefined', () => {
		const binding: NoteBinding = {
			targets: [{ url: '', pageId: '111' }],
			lastVersion: { a: { '111': 4 } },
		};
		expect(getLastVersionForTarget(binding, 'a', '111')).toBe(4);
		expect(getLastVersionForTarget(binding, 'a', '999')).toBeUndefined();
		expect(getLastVersionForTarget(binding, 'b', '111')).toBeUndefined();
	});
});
