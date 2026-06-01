import { LogEntry } from '../types';

const PREFIX = '[Sync Confluence]';

export class Logger {
	private logs: LogEntry[] = [];
	private readonly maxLogs = 200;
	private lastSyncTime: Date | null = null;
	private listeners = new Set<() => void>();

	addListener(cb: () => void): void {
		this.listeners.add(cb);
	}

	removeListener(cb: () => void): void {
		this.listeners.delete(cb);
	}

	private notify(): void {
		this.listeners.forEach((cb) => {
			try { cb(); } catch { /* ignore */ }
		});
	}

	info(message: string, details?: string): void {
		this.push('info', message, details);
		console.log(PREFIX, message, details ?? '');
	}

	warn(message: string, details?: string): void {
		this.push('warn', message, details);
		console.warn(PREFIX, message, details ?? '');
	}

	error(message: string, details?: string): void {
		this.push('error', message, details);
		console.error(PREFIX, message, details ?? '');
	}

	private push(level: LogEntry['level'], message: string, details?: string): void {
		this.logs.push({ timestamp: new Date(), level, message, details });
		if (this.logs.length > this.maxLogs) {
			this.logs = this.logs.slice(-this.maxLogs);
		}
		this.notify();
	}

	getLogs(): LogEntry[] {
		return [...this.logs];
	}

	getRecentLogs(count = 20): LogEntry[] {
		return this.logs.slice(-count);
	}

	clearLogs(): void {
		this.logs = [];
		this.notify();
	}

	recordSyncTime(): void {
		this.lastSyncTime = new Date();
	}

	getLastSyncTime(): Date | null {
		return this.lastSyncTime;
	}

	formatLogs(logs?: LogEntry[]): string {
		const target = logs ?? this.logs;
		return target.map((log) => {
			const time = log.timestamp.toLocaleString('zh-CN');
			const level = log.level.toUpperCase().padEnd(5);
			let line = `[${time}] ${level} ${log.message}`;
			if (log.details) line += `\n           ${log.details}`;
			return line;
		}).join('\n');
	}
}
