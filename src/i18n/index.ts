import { en, type Messages } from './en';
import { zh } from './zh';

type Dict = Messages;

/**
 * Detect the active locale once at module load.
 *
 * Obsidian's i18n stores the user-selected language in
 * `window.localStorage.getItem('language')`. We follow that so the plugin
 * tracks the host UI without a separate setting.
 *
 * Anything starting with `zh` (zh, zh-CN, zh-TW, …) → Chinese.
 * Everything else → English.
 */
function detectLocale(): 'en' | 'zh' {
	try {
		const stored = typeof window !== 'undefined' && window.localStorage
			? window.localStorage.getItem('language')
			: null;
		if (stored && stored.toLowerCase().startsWith('zh')) return 'zh';
	} catch {
		// localStorage may be unavailable in test runs; fall through to en.
	}
	return 'en';
}

const LOCALE = detectLocale();
const MESSAGES: Dict = LOCALE === 'zh' ? zh : en;

export function getLocale(): 'en' | 'zh' {
	return LOCALE;
}

/**
 * Resolve a dotted key path like `settings.section.auth` against the active
 * message dictionary and interpolate `{name}` placeholders from `params`.
 *
 * Missing keys return the key itself so problems are visible during dev
 * instead of failing silently.
 */
export function t(path: string, params?: Record<string, string | number>): string {
	const parts = path.split('.');
	let cursor: unknown = MESSAGES;
	for (const p of parts) {
		if (cursor && typeof cursor === 'object' && p in (cursor as Record<string, unknown>)) {
			cursor = (cursor as Record<string, unknown>)[p];
		} else {
			return path;
		}
	}
	if (typeof cursor !== 'string') return path;
	if (!params) return cursor;
	return cursor.replace(/\{(\w+)\}/g, (_m, k: string) => {
		const v = params[k];
		return v === undefined || v === null ? `{${k}}` : String(v);
	});
}
