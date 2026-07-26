/**
 * URL normalization & longest-prefix routing helpers.
 *
 * Single source of truth for matching a Confluence page URL against an
 * instance's `baseUrl`. We need boundary-aware comparison (`/wiki` must not
 * match `/wikievil`) plus equal protocol + host matching, otherwise a hostile
 * URL like `https://example.com.evil.test` could match baseUrl
 * `https://example.com`.
 */

import type { Frontmatter } from '../frontmatter/handler';

/** Try to parse `raw` as URL; returns null for non-string / unparseable inputs. */
export function tryParseUrl(raw: unknown): URL | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed);
	} catch {
		return null;
	}
}

/**
 * Longest-prefix match with host-boundary safety:
 *  - protocols must match
 *  - hostnames must be equal
 *  - pathname: equal OR `target.pathname` starts with `base.pathname + '/'`
 *
 * Returns true if any non-empty prefix of `targetUrl` exactly matches
 * `baseUrl` per the rules above. Case-insensitive.
 */
export function urlMatchesBaseUrl(targetUrl: string, baseUrl: string): boolean {
	const target = tryParseUrl(targetUrl);
	const base = tryParseUrl(baseUrl);
	if (!target || !base) return false;
	if (target.protocol !== base.protocol) return false;
	const targetHost = `${target.hostname.toLowerCase()}${target.port ? `:${target.port}` : ''}`;
	const baseHost = `${base.hostname.toLowerCase()}${base.port ? `:${base.port}` : ''}`;
	if (targetHost !== baseHost) return false;
	// Path is also case-folded: Confluence page slugs are case-insensitive
	// (Confluence Cloud renames /wiki/PAGE → /wiki/page freely), and the
	// docs above promise "Case-insensitive" matching.
	const tp = target.pathname.replace(/\/+$/, '').toLowerCase();
	const bp = base.pathname.replace(/\/+$/, '').toLowerCase();
	if (bp === '') return true;
	if (tp === bp) return true;
	return tp.startsWith(bp + '/');
}

/**
 * Partition a string of comma-separated URLs into an array of trimmed
 * non-empty segments. Accepts both `,` and `，` (Chinese comma) as
 * separators, mirroring the CSV splitter used for `confluence_url` and
 * `confluence_parent_url` frontmatter.
 */
export function splitCsvUrls(raw: string): string[] {
	return raw.split(/[，,]/u).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Extract every target URL from a note's binding frontmatter. Reads
 * `confluence_url` (using the configured `urlKey`) and
 * `confluence_parent_url`, handling all three supported frontmatter formats
 * (scalar, CSV, array). Empty / non-string entries are skipped.
 *
 * Single source of truth — used by syncAll, syncFolder, syncFile, and the
 * runInstanceGroup helper. Replaces three near-identical copies that
 * previously drifted apart.
 */
export function extractTargetUrls(
	fm: Frontmatter,
	urlKey: string,
): string[] {
	const result: string[] = [];
	const push = (raw: unknown): void => {
		if (typeof raw === 'string') {
			for (const u of splitCsvUrls(raw)) result.push(u);
		} else if (Array.isArray(raw)) {
			for (const item of raw) {
				if (typeof item === 'string') {
					for (const u of splitCsvUrls(item)) result.push(u);
				}
			}
		}
	};
	push(fm[urlKey]);
	push(fm['confluence_parent_url']);
	return result;
}

/**
 * Extract the first non-empty target URL from a note's binding frontmatter.
 * Used by error messages where a single URL is needed for display.
 */
export function extractFirstTargetUrl(
	fm: Frontmatter,
	urlKey: string,
): string {
	const all = extractTargetUrls(fm, urlKey);
	return all[0] ?? '';
}
