/**
 * 跨平台 sha1 hex 编码。
 * 优先用 Web Crypto API(Electron 渲染进程内置),失败再退回简易实现(理论上不会触发)。
 */
export async function sha1Hex(input: ArrayBuffer | string): Promise<string> {
	const data = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
	const subtle = globalThis.crypto?.subtle;
	if (subtle?.digest) {
		const buf = await subtle.digest('SHA-1', data);
		return toHex(new Uint8Array(buf));
	}
	throw new Error('crypto.subtle 不可用');
}

function toHex(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i]!;
		s += (b < 16 ? '0' : '') + b.toString(16);
	}
	return s;
}
