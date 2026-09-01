import { describe, expect, test } from 'bun:test';
import { isCleartextHttpUrl } from '../src/confluence/urlMatch';

describe('isCleartextHttpUrl', () => {
	test('detects http URLs regardless of case or trailing slash', () => {
		expect(isCleartextHttpUrl('http://confluence.local')).toBe(true);
		expect(isCleartextHttpUrl('HTTP://confluence.local/wiki/')).toBe(true);
		expect(isCleartextHttpUrl('  http://10.0.0.5:8090  ')).toBe(true);
	});

	test('does not flag https or empty values', () => {
		expect(isCleartextHttpUrl('https://xxx.atlassian.net/wiki')).toBe(false);
		expect(isCleartextHttpUrl('HTTPS://confluence.example.com')).toBe(false);
		expect(isCleartextHttpUrl('')).toBe(false);
		expect(isCleartextHttpUrl('not a url')).toBe(false);
	});
});
