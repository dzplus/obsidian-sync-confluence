import type { App, TFile } from 'obsidian';
import { ConfluenceInstance } from '../types';
import { tryParseUrl, urlMatchesBaseUrl, extractTargetUrls } from '../confluence/urlMatch';
import type { Frontmatter } from '../frontmatter/handler';

export interface InstanceResolverDeps {
	instances: ConfluenceInstance[];
}

/**
 * Resolve a note URL to its owning Confluence instance.
 *
 * Longest-prefix-match with host-boundary safety: target and base must share
 * the same protocol and host, and the path must be either equal to the base
 * or start with `base + '/'`. This protects against
 * `https://example.com` / `https://example.com.evil.test` style attacks.
 */
export class InstanceResolver {
	constructor(private deps: InstanceResolverDeps) {}

	resolve(url: string): ConfluenceInstance | null {
		if (!url || typeof url !== 'string') return null;
		if (!tryParseUrl(url)) return null;

		let best: ConfluenceInstance | null = null;
		let bestLen = -1;

		for (const inst of this.deps.instances) {
			if (!inst.baseUrl) continue;
			if (!tryParseUrl(inst.baseUrl)) continue;
			if (!urlMatchesBaseUrl(url, inst.baseUrl)) continue;
			const normalizedLen = inst.baseUrl
				.trim()
				.replace(/\/+$/, '')
				.length;
			if (normalizedLen > bestLen) {
				best = inst;
				bestLen = normalizedLen;
			}
		}

		return best;
	}

	/**
	 * Multi-instance + multi-target: for each file collect ALL URLs across all of
	 * its targets (URL and parent URL of every target, handling CSV/array form),
	 * and match each URL against the configured instances. A file lands in an
	 * instance's group when at least one of its target URLs matches that
	 * instance. A file can land in multiple groups (cross-instance multi-target);
	 * each engine then filters its "own" targets by instanceBaseUrl.
	 *
	 * unmatched: none of the target URLs matched any configured instance.
	 */
	groupByInstance(
		files: TFile[],
		app: App,
		frontmatterKey: string,
	): {
		groups: Map<string, { instance: ConfluenceInstance; files: TFile[] }>;
		unmatched: TFile[];
	} {
		const groups = new Map<string, { instance: ConfluenceInstance; files: TFile[] }>();
		const unmatched: TFile[] = [];

		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			const fm = (cache?.frontmatter ?? {}) as Frontmatter;
			const urls = extractTargetUrls(fm, frontmatterKey);
			if (urls.length === 0) {
				unmatched.push(file);
				continue;
			}

			const matchedInstances = new Map<string, ConfluenceInstance>();
			for (const url of urls) {
				const inst = this.resolve(url);
				if (inst && !matchedInstances.has(inst.id)) matchedInstances.set(inst.id, inst);
			}
			if (matchedInstances.size === 0) {
				unmatched.push(file);
				continue;
			}

			for (const inst of matchedInstances.values()) {
				const existing = groups.get(inst.id);
				if (existing) {
					existing.files.push(file);
				} else {
					groups.set(inst.id, { instance: inst, files: [file] });
				}
			}
		}

		return { groups, unmatched };
	}
}