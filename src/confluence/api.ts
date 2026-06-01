import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import * as https from 'https';
import * as http from 'http';
import { URL as NodeURL } from 'url';

export class ConfluenceApiError extends Error {
	constructor(public status: number, public code: ConfluenceErrorCode, message: string, public details?: string) {
		super(message);
		this.name = 'ConfluenceApiError';
	}
}

export type ConfluenceErrorCode =
	| 'auth_failed'
	| 'not_found'
	| 'version_conflict'
	| 'rate_limited'
	| 'network'
	| 'invalid_response'
	| 'unknown';

export interface PageInfo {
	id: string;
	title: string;
	version: number;
	type: string;
	spaceKey?: string;
}

export interface UpdatePagePayload {
	title: string;
	storageXhtml: string;
	newVersion: number;
}

export interface AttachmentMeta {
	id: string;
	filename: string;
	version: number;
	mediaType?: string;
}

export type ConfluenceAuthType = 'basic' | 'bearer';

export interface ConfluenceApiConfig {
	baseUrl: string;
	authType: ConfluenceAuthType;
	/** authType=basic 时必填:Cloud 是 email,Server 是域账号;authType=bearer 时忽略 */
	username: string;
	/** authType=basic:Cloud 的 API Token 或 Server 域账号密码;authType=bearer:PAT */
	apiToken: string;
}

/**
 * Confluence REST v1 客户端,走 Obsidian requestUrl(避免 CORS,且默认带 Electron UA)。
 *
 * 关键设计:
 * - baseUrl 归一化为不含尾部 / 的形式,如 https://xxx.atlassian.net/wiki
 * - Basic Auth: Authorization: Basic base64(username:token)
 * - 错误统一为 ConfluenceApiError,带分类的 code 便于上层做差异化处理
 */
export class ConfluenceApi {
	private baseUrl: string;
	private authHeader: string;

	constructor(config: ConfluenceApiConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, '');
		if (config.authType === 'bearer') {
			this.authHeader = `Bearer ${config.apiToken}`;
		} else {
			this.authHeader = `Basic ${encodeBase64Utf8(`${config.username}:${config.apiToken}`)}`;
		}
	}

	/** GET /rest/api/user/current — 用作 token 验证。返回当前用户 displayName。 */
	async validateAuth(): Promise<{ ok: true; displayName: string } | { ok: false; error: string }> {
		try {
			const res = await this.request({
				method: 'GET',
				url: `${this.baseUrl}/rest/api/user/current`,
			});
			const data = JSON.parse(res.text) as { displayName?: string; email?: string };
			return { ok: true, displayName: data.displayName ?? data.email ?? '<unknown>' };
		} catch (e) {
			const err = e as ConfluenceApiError;
			return { ok: false, error: err.message };
		}
	}

	/** GET 单个页面元信息(version + title)。 */
	async getPage(pageId: string): Promise<PageInfo> {
		const res = await this.request({
			method: 'GET',
			url: `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}?expand=version,space`,
		});
		const data = JSON.parse(res.text) as {
			id: string;
			title: string;
			type: string;
			version?: { number: number };
			space?: { key: string };
		};
		return {
			id: data.id,
			title: data.title,
			version: data.version?.number ?? 1,
			type: data.type,
			spaceKey: data.space?.key,
		};
	}

	/** POST 创建子页面。返回新页面 ID 与 webui URL(用于回写 frontmatter)。 */
	async createPage(opts: {
		spaceKey: string;
		parentId: string;
		title: string;
		storageXhtml: string;
	}): Promise<{ id: string; title: string; webUrl: string }> {
		const body = JSON.stringify({
			type: 'page',
			title: opts.title,
			space: { key: opts.spaceKey },
			ancestors: [{ id: opts.parentId }],
			body: {
				storage: {
					value: opts.storageXhtml,
					representation: 'storage',
				},
			},
		});
		// 实测 Obsidian requestUrl 对 POST + JSON body 会触发 Confluence Server XSRF 误判,
		// 跟 multipart 一样走 Electron 内置 Node https 直发。PUT 用 requestUrl 是 OK 的,只 POST 有问题。
		const bodyBuf = Buffer.from(body, 'utf8');
		const url = `${this.baseUrl}/rest/api/content`;
		const { status, text } = await nodeHttpsRequest({
			url,
			method: 'POST',
			headers: {
				Authorization: this.authHeader,
				Accept: 'application/json',
				'X-Atlassian-Token': 'no-check',
				'Content-Type': 'application/json',
				'Content-Length': String(bodyBuf.length),
			},
			body: bodyBuf,
		});
		if (status < 200 || status >= 300) {
			const code = classifyError(status);
			const details = truncate(text, 500);
			throw new ConfluenceApiError(status, code, buildErrorMessage('POST', url, status, details), details);
		}
		const data = JSON.parse(text) as {
			id: string;
			title: string;
			_links?: { base?: string; webui?: string };
		};
		const base = data._links?.base ?? this.baseUrl;
		const webui = data._links?.webui ?? `/pages/viewpage.action?pageId=${data.id}`;
		return { id: data.id, title: data.title, webUrl: base + webui };
	}

	/** PUT 更新页面。失败时若是 409 → 抛 version_conflict,调用方可重试。 */
	async updatePage(pageId: string, payload: UpdatePagePayload): Promise<void> {
		const body = JSON.stringify({
			id: pageId,
			type: 'page',
			title: payload.title,
			version: { number: payload.newVersion },
			body: {
				storage: {
					value: payload.storageXhtml,
					representation: 'storage',
				},
			},
		});
		await this.request({
			method: 'PUT',
			url: `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}`,
			contentType: 'application/json',
			body,
			extraHeaders: { 'X-Atlassian-Token': 'no-check' },
		});
	}

	/** 列出指定 filename 的附件,用于判断是新增还是更新版本。 */
	async findAttachmentByFilename(pageId: string, filename: string): Promise<AttachmentMeta | null> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?filename=${encodeURIComponent(filename)}`;
		const res = await this.request({ method: 'GET', url });
		const data = JSON.parse(res.text) as {
			results?: Array<{
				id: string;
				title: string;
				version?: { number: number };
				metadata?: { mediaType?: string };
			}>;
		};
		const first = data.results?.[0];
		if (!first) return null;
		return {
			id: first.id,
			filename: first.title,
			version: first.version?.number ?? 1,
			mediaType: first.metadata?.mediaType,
		};
	}

	/** 新增附件: POST /rest/api/content/{pageId}/child/attachment (multipart) */
	async createAttachment(pageId: string, filename: string, data: ArrayBuffer, mimeType: string): Promise<AttachmentMeta> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`;
		const res = await this.uploadMultipart(url, filename, data, mimeType);
		const parsed = JSON.parse(res.text) as { results: Array<{ id: string; title: string; version?: { number: number } }> };
		const r = parsed.results[0];
		if (!r) throw new ConfluenceApiError(500, 'invalid_response', 'Confluence 返回 results 为空');
		return { id: r.id, filename: r.title, version: r.version?.number ?? 1 };
	}

	/** 更新已有附件的二进制内容: POST /rest/api/content/{pageId}/child/attachment/{attId}/data */
	async updateAttachment(pageId: string, attachmentId: string, filename: string, data: ArrayBuffer, mimeType: string): Promise<AttachmentMeta> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/data`;
		const res = await this.uploadMultipart(url, filename, data, mimeType);
		const parsed = JSON.parse(res.text) as { id: string; title: string; version?: { number: number } };
		return { id: parsed.id ?? attachmentId, filename: parsed.title ?? filename, version: parsed.version?.number ?? 1 };
	}

	private async uploadMultipart(url: string, filename: string, data: ArrayBuffer, mimeType: string): Promise<RequestUrlResponse> {
		// 多 multipart 上传不走 fetch(CORS)也不走 Obsidian requestUrl(实测对 binary body
		// 处理后 Confluence Server 仍判 XSRF 失败),改用 Electron 内置 Node https 模块直发。
		// 在 Bun 隔离环境用同样的 Request+FormData 序列化 + fetch 验证过 Confluence 接受此格式。
		const fd = new FormData();
		fd.append('file', new Blob([data as BlobPart], { type: mimeType }), filename);
		const tmp = new Request('http://placeholder.invalid/', { method: 'POST', body: fd });
		const contentType = tmp.headers.get('Content-Type') ?? 'multipart/form-data';
		const bodyBuf = Buffer.from(await tmp.arrayBuffer());

		const { status, text } = await nodeHttpsRequest({
			url,
			method: 'POST',
			headers: {
				Authorization: this.authHeader,
				Accept: 'application/json',
				'X-Atlassian-Token': 'no-check',
				'Content-Type': contentType,
				'Content-Length': String(bodyBuf.length),
			},
			body: bodyBuf,
		});

		if (status >= 200 && status < 300) {
			return { status, headers: {}, arrayBuffer: new ArrayBuffer(0), json: null as unknown, text } as RequestUrlResponse;
		}
		const code = classifyError(status);
		const details = truncate(text, 500);
		throw new ConfluenceApiError(status, code, buildErrorMessage('POST', url, status, details), details);
	}

	private async request(opts: {
		method: string;
		url: string;
		body?: string | ArrayBuffer;
		contentType?: string;
		extraHeaders?: Record<string, string>;
	}): Promise<RequestUrlResponse> {
		const headers: Record<string, string> = {
			Authorization: this.authHeader,
			Accept: 'application/json',
			...(opts.extraHeaders ?? {}),
		};
		if (opts.contentType) headers['Content-Type'] = opts.contentType;

		const param: RequestUrlParam = {
			method: opts.method,
			url: opts.url,
			headers,
			body: opts.body,
			throw: false,
		};

		let res: RequestUrlResponse;
		try {
			res = await requestUrl(param);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new ConfluenceApiError(0, 'network', `网络请求失败: ${msg}`);
		}

		if (res.status >= 200 && res.status < 300) return res;

		const code = classifyError(res.status);
		const details = truncate(safeText(res), 500);
		const message = buildErrorMessage(opts.method, opts.url, res.status, details);
		throw new ConfluenceApiError(res.status, code, message, details);
	}
}

function classifyError(status: number): ConfluenceErrorCode {
	if (status === 401 || status === 403) return 'auth_failed';
	if (status === 404) return 'not_found';
	if (status === 409) return 'version_conflict';
	if (status === 429) return 'rate_limited';
	return 'unknown';
}

function safeText(res: RequestUrlResponse): string {
	try { return res.text ?? ''; } catch { return ''; }
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + '...';
}

function buildErrorMessage(method: string, url: string, status: number, details: string): string {
	const path = url.replace(/^https?:\/\/[^/]+/, '');
	return `Confluence ${method} ${path} → ${status}${details ? ': ' + details : ''}`;
}


/**
 * 通过 Electron 内置 Node https/http 模块直发请求 — 绕开浏览器 CORS 与 Obsidian
 * requestUrl 对 binary body 的处理。
 */
function nodeHttpsRequest(opts: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: Buffer;
}): Promise<{ status: number; text: string }> {
	return new Promise((resolve, reject) => {
		const parsed = new NodeURL(opts.url);
		const lib = parsed.protocol === 'http:' ? http : https;
		const req = lib.request({
			protocol: parsed.protocol,
			hostname: parsed.hostname,
			port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
			path: parsed.pathname + parsed.search,
			method: opts.method,
			headers: opts.headers,
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve({ status: res.statusCode ?? 0, text });
			});
		});
		req.on('error', (e) => reject(e));
		req.write(opts.body);
		req.end();
	});
}

/** UTF-8 安全的 Base64 编码;Obsidian 桌面端跑在 Electron,btoa 在浏览器侧可用,只接受 latin1。 */
function encodeBase64Utf8(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
}
