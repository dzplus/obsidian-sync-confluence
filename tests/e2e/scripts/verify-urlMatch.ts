/**
 * Boundary-safety tests for urlMatchesBaseUrl.
 *
 * The helper at src/confluence/urlMatch.ts:1-9 explicitly claims to defend
 * against:
 *   - `https://example.com.evil.test` matching `https://example.com`
 *     (host-boundary attack)
 *   - `/wiki` matching `/wikievil` (path-boundary attack)
 *
 * Without these tests, a future refactor could silently regress the
 * boundary safety. Pure functions, no Obsidian harness needed.
 *
 * Run with: bun tests/e2e/scripts/verify-urlMatch.ts
 * Exits non-zero on any assertion failure.
 */

import { urlMatchesBaseUrl, splitCsvUrls } from '../../../src/confluence/urlMatch';

function assert(cond: unknown, msg: string): void {
	if (cond !== true) {
		console.error(`FAIL: ${msg}`);
		process.exit(1);
	}
	console.log(`  ok: ${msg}`);
}

console.log('Host-boundary attacks');
{
	assert(urlMatchesBaseUrl('https://example.com/wiki', 'https://example.com') === true,
		'plain host matches itself');
	assert(urlMatchesBaseUrl('https://example.com/wiki/pages/123', 'https://example.com') === true,
		'subpath matches host base');
	assert(urlMatchesBaseUrl('https://example.com.evil.test/wiki', 'https://example.com') === false,
		'subdomain-prefix attack is rejected (evil.test != example.com)');
	assert(urlMatchesBaseUrl('https://notexample.com/wiki', 'https://example.com') === false,
		'different host is rejected');
	assert(urlMatchesBaseUrl('https://example.com.evil.com/wiki', 'https://example.com') === false,
		'subdomain-suffix attack is rejected');
}

console.log('\nPath-boundary attacks');
{
	assert(urlMatchesBaseUrl('https://example.com/wiki', 'https://example.com/wiki') === true,
		'equal path matches');
	assert(urlMatchesBaseUrl('https://example.com/wiki/page', 'https://example.com/wiki') === true,
		'path subdirectory matches');
	assert(urlMatchesBaseUrl('https://example.com/wikievil', 'https://example.com/wiki') === false,
		'path-prefix attack is rejected (wikievil not under wiki/)');
	assert(urlMatchesBaseUrl('https://example.com/wikievil/pages', 'https://example.com/wiki') === false,
		'path-prefix attack on subdirectory is rejected');
	assert(urlMatchesBaseUrl('https://example.com/', 'https://example.com/wiki') === false,
		'host-only path does not match deeper base');
}

console.log('\nCase insensitivity');
{
	assert(urlMatchesBaseUrl('https://Example.COM/wiki', 'https://example.com') === true,
		'hostnames case-folded');
	assert(urlMatchesBaseUrl('https://example.com/Wiki', 'https://example.com/wiki') === true,
		'path case-folded');
}

console.log('\nProtocol match');
{
	assert(urlMatchesBaseUrl('http://example.com/wiki', 'https://example.com') === false,
		'http target does not match https base');
	// Default ports (443 for https, 80 for http) are stripped by the URL
	// parser, so `https://example.com:443` and `https://example.com` are
	// normalized to the same host and match. Non-default ports DO matter:
	assert(urlMatchesBaseUrl('https://example.com:8443/wiki', 'https://example.com:8080') === false,
		'non-default port mismatch is rejected');
}

console.log('\nEdge cases');
{
	assert(urlMatchesBaseUrl('', 'https://example.com') === false,
		'empty target is rejected');
	assert(urlMatchesBaseUrl('https://example.com/wiki', '') === false,
		'empty base is rejected');
	assert(urlMatchesBaseUrl('not a url', 'https://example.com') === false,
		'unparseable target is rejected');
	assert(urlMatchesBaseUrl('https://example.com/wiki', 'not a url') === false,
		'unparseable base is rejected');
	assert(urlMatchesBaseUrl('https://example.com/wiki/', 'https://example.com/wiki') === true,
		'trailing slash on target is normalized');
	assert(urlMatchesBaseUrl('https://example.com/wiki', 'https://example.com/wiki/') === true,
		'trailing slash on base is normalized');
}

console.log('\nsplitCsvUrls — Chinese-comma regression (B1)');
{
	const urls = splitCsvUrls('https://a.com，https://b.com');
	assert(urls.length === 2,
		'Chinese fullwidth comma splits');
	assert(urls[0] === 'https://a.com' && urls[1] === 'https://b.com',
		'segments are correctly extracted');
	const mixed = splitCsvUrls('https://a.com, https://b.com，https://c.com');
	assert(mixed.length === 3 && mixed[2] === 'https://c.com',
		'mixed ASCII + Chinese commas both split');
}

console.log('\nAll boundary tests passed.');
