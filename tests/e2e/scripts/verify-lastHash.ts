/**
 * Standalone verification for the per-instance lastHash and attachments
 * merge helpers in src/frontmatter/handler.ts.
 *
 * Runs without a real Confluence / Obsidian instance — exercises the pure
 * helpers:
 *   - getLastHashForTarget
 *   - mergeLastHash
 *   - mergeAttachments
 *   - isLegacyFlatAttachmentMap
 *
 * Production code only handles the current per-instance shape:
 *   - lastHash: `{ instanceId: { pageId: hash } }`
 *   - attachments: `{ instanceId: { pageId: { filename: record } } }`
 *
 * Pre-multi-instance legacy forms (string lastHash, flat attachments) are
 * handled by `migrateLegacyFrontmatter` in main.ts; by the time the merge
 * helpers run in production, those shapes have already been converted.
 *
 * Run with: bun tests/e2e/scripts/verify-lastHash.ts
 * Exits non-zero on any assertion failure.
 */

import {
	getLastHashForTarget,
	mergeLastHash,
	mergeAttachments,
} from '../../../src/frontmatter/handler';
import { isLegacyFlatAttachmentMap } from '../../../src/migration';
import type { NoteBinding } from '../../../src/types';

function sortObject<T>(v: T): T {
	if (v === null || typeof v !== 'object') return v;
	if (Array.isArray(v)) return v.map(sortObject) as unknown as T;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(v as Record<string, unknown>).sort()) {
		out[key] = sortObject((v as Record<string, unknown>)[key]);
	}
	return out as T;
}

function assertDeepEqual(actual: unknown, expected: unknown, msg: string): void {
	const a = JSON.stringify(sortObject(actual));
	const e = JSON.stringify(sortObject(expected));
	if (a !== e) {
		console.error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
		process.exit(1);
	}
	console.log(`  ok: ${msg}`);
}

function assert(cond: unknown, msg: string): void {
	if (cond !== true) {
		console.error(`FAIL: ${msg}`);
		process.exit(1);
	}
	console.log(`  ok: ${msg}`);
}

console.log('Scenario 1: foreign instance slices preserved verbatim');
{
	const result = mergeLastHash(
		{
			'a': { '111': 'a-hash' },
			'b': { '222': 'b-hash' },
		},
		{ 'a': { '111': 'a-hash-2' } },
	);
	assertDeepEqual(
		result,
		{
			'a': { '111': 'a-hash-2' },
			'b': { '222': 'b-hash' },
		},
		'engine A updates its slice; engine B slice untouched',
	);
}

console.log('\nScenario 2: cross-instance pageId collision (123 on both A and B)');
{
	const result = mergeLastHash(
		{},
		{
			'a': { '123': 'a-hash' },
			'b': { '123': 'b-hash' },
		},
	);
	assertDeepEqual(
		result,
		{ 'a': { '123': 'a-hash' }, 'b': { '123': 'b-hash' } },
		'same pageId in two engines lands under different instanceId keys — no collision',
	);
}

console.log('\nScenario 3: empty engine slice dropped');
{
	const result = mergeLastHash(
		{ 'a': { '111': 'a-hash' } },
		{ 'b': {} },
	);
	assertDeepEqual(
		result,
		{ 'a': { '111': 'a-hash' } },
		'empty engine slice does not appear in frontmatter',
	);
}

console.log('\nScenario 4: chained A→B writes — B merges against A result');
{
	const afterA = mergeLastHash(
		{},
		{ 'a': { '111': 'a-hash' } },
	);
	const afterB = mergeLastHash(
		afterA,
		{ 'b': { '222': 'b-hash' } },
	);
	assertDeepEqual(
		afterB,
		{
			'a': { '111': 'a-hash' },
			'b': { '222': 'b-hash' },
		},
		'B does not clobber A; both slices coexist',
	);
}

console.log('\nScenario 5: getLastHashForTarget priority and miss cases');
{
	const binding: NoteBinding = {
		targets: [
			{ url: 'https://a.example.com/wiki/spaces/X/pages/111', pageId: '111' },
			{ url: 'https://b.example.com/wiki/spaces/Y/pages/222', pageId: '222' },
		],
		lastHash: {
			'a': { '111': 'a-hash' },
			'b': { '222': 'b-hash' },
		},
	};
	assert(getLastHashForTarget(binding, 'a', '111') === 'a-hash', 'own slice hit');
	assert(getLastHashForTarget(binding, 'b', '222') === 'b-hash', 'foreign instance slice hit');
	assert(getLastHashForTarget(binding, 'a', '999') === undefined, 'missing pageId → undefined');

	const emptyBinding: NoteBinding = {
		targets: [{ url: 'https://a.example.com/wiki/spaces/X/pages/111', pageId: '111' }],
	};
	assert(getLastHashForTarget(emptyBinding, 'a', '111') === undefined, 'no lastHash → undefined');
}

console.log('\nScenario 6: mergeAttachments — per-pageId replace and foreign slice preservation');
{
	const result = mergeAttachments(
		{
			'b': { '222': { 'doc.pdf': { hash: 'h3', id: 'att3' } } },
		},
		{
			'a': {
				'111': { 'image.png': { hash: 'h1', id: 'att1' } },
			},
		},
	);
	assertDeepEqual(
		result,
		{
			'a': { '111': { 'image.png': { hash: 'h1', id: 'att1' } } },
			'b': { '222': { 'doc.pdf': { hash: 'h3', id: 'att3' } } },
		},
		'engine A writes own slice; foreign slice preserved',
	);
}

console.log('\nScenario 7: stale attachment drop on engine delta');
{
	const dropped = mergeAttachments(
		{
			'a': {
				'111': {
					'image.png': { hash: 'h1', id: 'att1' },
					'old.pdf': { hash: 'h2', id: 'att2' },
				},
			},
		},
		{
			'a': {
				'111': { 'image.png': { hash: 'h3', id: 'att1' } },
			},
		},
	);
	assertDeepEqual(
		dropped,
		{
			'a': {
				'111': { 'image.png': { hash: 'h3', id: 'att1' } },
			},
		},
		'stale attachment (old.pdf) is dropped when engine delta omits it',
	);
}

console.log('\nScenario 8: isLegacyFlatAttachmentMap identifies pre-multi-instance shape');
{
	assert(isLegacyFlatAttachmentMap({ 'img.png': { hash: 'h1', id: 'att1' } }) === true,
		'flat `{ filename: rec }` is legacy');
	assert(isLegacyFlatAttachmentMap({ 'a': { '111': { 'img.png': { hash: 'h1', id: 'att1' } } } }) === false,
		'current per-instance shape is NOT legacy');
	assert(isLegacyFlatAttachmentMap('not-an-object') === false, 'string is NOT legacy');
	assert(isLegacyFlatAttachmentMap(undefined) === false, 'undefined is NOT legacy');
	assert(isLegacyFlatAttachmentMap(null) === false, 'null is NOT legacy');
}

console.log('\nAll scenarios passed.');