/**
 * 从 Confluence 页面 URL 解析 page ID。
 *
 * 支持两种常见格式:
 * - https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Title
 * - https://xxx.atlassian.net/wiki/pages/viewpage.action?pageId=123456
 */
export function parsePageIdFromUrl(url: string): string | null {
	if (!url) return null;

	const pathMatch = url.match(/\/pages\/(\d+)(?:\/|$|\?|#)/);
	if (pathMatch && pathMatch[1]) return pathMatch[1];

	const queryMatch = url.match(/[?&]pageId=(\d+)/i);
	if (queryMatch && queryMatch[1]) return queryMatch[1];

	return null;
}
