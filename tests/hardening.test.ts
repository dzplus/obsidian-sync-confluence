import { describe, expect, test } from 'bun:test';
import { mergeLastHash, mergeAttachments, isUnsafeObjectKey } from '../src/frontmatter/handler';
import { ConfluenceApiError, formatApiErrorForLog } from '../src/confluence/api';

describe('isUnsafeObjectKey', () => {
	test('rejects prototype-pollution keys', () => {
		expect(isUnsafeObjectKey('__proto__')).toBe(true);
		expect(isUnsafeObjectKey('constructor')).toBe(true);
		expect(isUnsafeObjectKey('prototype')).toBe(true);
		expect(isUnsafeObjectKey('default')).toBe(false);
		expect(isUnsafeObjectKey('123')).toBe(false);
	});
});

describe('mergeLastHash prototype-key guards', () => {
	test('ignores __proto__ / constructor / prototype in existing and delta', () => {
		const existing = JSON.parse('{"default":{"111":"aaa"},"__proto__":{"999":"evil"},"constructor":{"888":"evil"}}') as Record<string, Record<string, string>>;
		const delta = JSON.parse('{"default":{"111":"bbb","prototype":"nope"},"__proto__":{"777":"evil"}}') as Record<string, Record<string, string>>;
		const result = mergeLastHash(existing, delta);
		expect(result).toEqual({ default: { '111': 'bbb' } });
		expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result.default, 'prototype')).toBe(false);
	});
});

describe('mergeAttachments prototype-key guards', () => {
	test('ignores unsafe keys at every nesting level', () => {
		const existing = JSON.parse('{"default":{"111":{"img.png":{"hash":"h1","id":"id1"}},"__proto__":{"x.png":{"hash":"hx","id":"idx"}}},"constructor":{"222":{"y.png":{"hash":"hy","id":"idy"}}}}');
		const delta = JSON.parse('{"default":{"111":{"img.png":{"hash":"h2","id":"id2"},"prototype":{"hash":"hp","id":"idp"}}},"__proto__":{"333":{"z.png":{"hash":"hz","id":"idz"}}}}');
		const result = mergeAttachments(existing, delta);
		expect(result).toEqual({
			default: {
				'111': { 'img.png': { hash: 'h2', id: 'id2' } },
			},
		});
		expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result.default['111'], 'prototype')).toBe(false);
	});
});

describe('formatApiErrorForLog', () => {
	test('keeps the short message for Notices and puts the body in details', () => {
		const err = new ConfluenceApiError(404, 'not_found', 'Confluence GET /rest/api/content/1 → 404', '<html>secret</html>');
		expect(err.message).toBe('Confluence GET /rest/api/content/1 → 404');
		expect(err.details).toBe('<html>secret</html>');
		expect(formatApiErrorForLog(err)).toContain('<html>secret</html>');
		expect(formatApiErrorForLog(err).startsWith(err.message)).toBe(true);
	});
});
