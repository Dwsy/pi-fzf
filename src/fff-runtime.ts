/**
 * pi-fzf - FZF-based runtime
 * 
 * Uses fzf CLI for fuzzy file finding.
 */

import { stat } from "node:fs/promises";
import { dirname, relative, resolve, basename } from "node:path";

export const DEFAULT_FILE_CANDIDATE_LIMIT = 8;
export const GREP_CURSOR_PREFIX = "grep:";
export const FIND_FILES_CURSOR_PREFIX = "find:";
export const MAX_GREP_CURSOR_STATES = 64;
export const AUTO_EXPAND_AFTER_CONTEXT = 6;
export const DEFAULT_GREP_LIMIT = 100;
export const MAX_MATCHES_PER_FILE = 200;
export const DEFAULT_FIND_FILES_LIMIT = 20;

export type FileItem = {
	relativePath: string;
	fileName: string;
	size: number;
	modified: number;
	accessFrecencyScore: number;
	modificationFrecencyScore: number;
	totalFrecencyScore: number;
	gitStatus: string;
};

export type Score = {
	total: number;
	baseScore: number;
	filenameBonus: number;
	specialFilenameBonus: number;
	frecencyBoost: number;
	distancePenalty: number;
	currentFilePenalty: number;
	comboMatchBoost: number;
	exactMatch: boolean;
	matchType: string;
};

export type FffFileCandidate = {
	item: FileItem;
	score?: Score;
};

export type ResolvedPath = {
	kind: "resolved";
	query: string;
	absolutePath: string;
	relativePath: string;
	pathType: "file" | "directory";
	candidates: FffFileCandidate[];
};

export type FindFilesRequest = {
	query: string;
	limit?: number;
	cursor?: string;
};

export type FindFilesResponse = {
	items: FffFileCandidate[];
	formatted: string;
	nextCursor?: string;
	totalMatched?: number;
	totalFiles?: number;
};

export type RuntimeOptions = {
	projectRoot?: string;
};

// Error classes
export class RuntimeError extends Error {
	constructor(public readonly step: string, message: string) {
		super(message);
		this.name = "RuntimeError";
	}
}

function normalizeSlashes(value: string): string {
	return value.replace(/\\/g, "/");
}

function execSync(cmd: string, opts?: { cwd?: string; timeout?: number; input?: string }): { stdout: string; stderr: string } {
	const { execFileSync } = require("child_process");
	const result = execFileSync("/bin/sh", ["-c", cmd], {
		cwd: opts?.cwd,
		timeout: opts?.timeout ?? 30000,
		input: opts?.input,
		encoding: "utf8",
		maxBuffer: 100 * 1024 * 1024,
	});
	return { stdout: result, stderr: "" };
}

async function getPathType(path: string): Promise<"file" | "directory" | null> {
	try {
		const info = await stat(path);
		if (info.isFile()) return "file";
		if (info.isDirectory()) return "directory";
		return null;
	} catch {
		return null;
	}
}

function relativeFrom(basePath: string, targetPath: string): string {
	const rel = normalizeSlashes(relative(basePath, targetPath));
	return rel === "" ? "." : rel;
}

function stripQuotes(value: string): string {
	if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
		return value.slice(1, -1);
	}
	if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
		return value.slice(1, -1);
	}
	return value;
}

function normalizePathQuery(value: string): string {
	let normalized = value.trim();
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	return normalizeSlashes(stripQuotes(normalized.trim()));
}

function decodeCursor<T>(cursor: string | undefined, prefix: string): T | null {
	if (!cursor?.startsWith(prefix)) return null;
	try {
		const decoded = Buffer.from(cursor.slice(prefix.length), "base64url").toString("utf8");
		return JSON.parse(decoded) as T;
	} catch {
		return null;
	}
}

function encodeCursor(prefix: string, payload: unknown): string {
	return `${prefix}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function shortenQuery(query: string): string | null {
	const words = query.split(/\s+/).filter((w) => w.length > 0);
	if (words.length < 3) return null;
	return words.slice(0, 2).join(" ");
}

function formatFindFilesText(query: string, items: FffFileCandidate[]): string {
	const lines: string[] = [];
	lines.push(`Found ${items.length} files matching "${query}"`);
	for (const item of items.slice(0, 10)) {
		lines.push(`  ${item.item.relativePath}`);
	}
	if (items.length > 10) {
		lines.push(`  ... and ${items.length - 10} more`);
	}
	return lines.join("\n");
}

async function findProjectRoot(cwd: string): Promise<string> {
	let dir = cwd;
	for (let i = 0; i < 10; i++) {
		try {
			await stat(`${dir}/.git`);
			return dir;
		} catch {
			// ignore
		}
		const parent = dir.replace(/\/[^/]+\/?$/, "");
		if (parent === dir) break;
		dir = parent;
	}
	return cwd;
}

/**
 * FZF Runtime
 */
export class FffRuntime {
	public readonly cwd: string;
	private basePath: string = "";
	private isReady = false;
	private indexedFiles = 0;
	private fileCache: string[] = [];
	private fileCacheTime = 0;
	private readonly CACHE_TTL = 30000;

	constructor(cwd: string, options: RuntimeOptions = {}) {
		this.cwd = cwd;
		this.basePath = options.projectRoot ?? cwd;
	}

	dispose(): void {
		this.isReady = false;
		this.fileCache = [];
	}

	async ensure(): Promise<void> {
		if (this.isReady) return;
		this.basePath = this.basePath || (await findProjectRoot(this.cwd));
		this.refreshCache();
		this.isReady = true;
	}

	async warm(timeoutMs = 1500): Promise<void> {
		try {
			await this.ensure();
		} catch {
			// Ignore warm errors
		}
	}

	async reindex(): Promise<void> {
		this.fileCache = [];
		this.fileCacheTime = 0;
		await this.ensure();
	}

	async findFiles(request: FindFilesRequest): Promise<FindFilesResponse> {
		await this.ensure();
		const query = normalizePathQuery(request.query);
		if (!query) {
			return { items: [], formatted: `Empty query: ${request.query}` };
		}

		const limit = Math.max(1, request.limit ?? 20);
		let searchQuery = query;

		// Try to get cached results or fresh search
		let items = this.fzfSearch(searchQuery, limit * 3);
		
		// Fallback with shorter query
		if (items.length === 0) {
			const shorter = shortenQuery(query);
			if (shorter) {
				searchQuery = shorter;
				items = this.fzfSearch(shorter, limit * 3);
			}
		}

		// Apply pagination
		const total = items.length;
		items = items.slice(0, limit);
		const nextCursor = total > limit ? encodeCursor(FIND_FILES_CURSOR_PREFIX, { query, searchQuery }) : undefined;

		return {
			items,
			formatted: formatFindFilesText(query, items),
			nextCursor,
			totalMatched: total,
			totalFiles: this.indexedFiles,
		};
	}

	async searchFileCandidates(query: string, limit = 8): Promise<FffFileCandidate[]> {
		await this.ensure();
		const normalized = normalizePathQuery(query);
		if (!normalized) return [];
		return this.fzfSearch(normalized, limit);
	}

	async resolvePath(query: string, options?: { allowDirectory?: boolean }): Promise<ResolvedPath> {
		await this.ensure();
		const normalized = normalizePathQuery(query);
		if (!normalized) {
			return {
				kind: "resolved",
				query,
				absolutePath: "",
				relativePath: "",
				pathType: "file",
				candidates: [],
			};
		}

		const candidates = this.fzfSearch(normalized, 8);
		const top = candidates[0];
		
		if (!top) {
			return {
				kind: "resolved",
				query,
				absolutePath: "",
				relativePath: "",
				pathType: "file",
				candidates: [],
			};
		}

		const absPath = resolve(this.basePath, top.item.relativePath);
		const pathType = (await getPathType(absPath)) ?? "file";

		return {
			kind: "resolved",
			query,
			absolutePath: absPath,
			relativePath: top.item.relativePath,
			pathType,
			candidates,
		};
	}

	async trackQuery(_query: string, _selectedPath: string): Promise<void> {}

	private refreshCache(): void {
		try {
			const { stdout } = execSync(`fd --type f --color never . "${this.basePath}"`, { timeout: 30000 });
			this.fileCache = stdout.split("\n").filter(Boolean);
		} catch {
			try {
				const { stdout } = execSync(
					`find "${this.basePath}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/target/*"`,
					{ timeout: 60000 }
				);
				this.fileCache = stdout.split("\n").filter(Boolean);
			} catch {
				this.fileCache = [];
			}
		}
		this.fileCacheTime = Date.now();
		this.indexedFiles = this.fileCache.length;
	}

	private fzfSearch(query: string, limit: number): FffFileCandidate[] {
		const now = Date.now();
		
		// Refresh cache if stale
		if (this.fileCache.length === 0 || now - this.fileCacheTime >= this.CACHE_TTL) {
			this.refreshCache();
		}

		if (this.fileCache.length === 0) return [];

		const relativePaths = this.fileCache.map((f) => this.makeRelative(f));
		
		try {
			const { stdout } = execSync(
				`fzf --filter "${query}" --print0 --no-extended --algo v1`,
				{ input: relativePaths.join("\0"), timeout: 5000 }
			);
			return stdout
				.split("\0")
				.filter(Boolean)
				.slice(0, limit)
				.map((relativePath) => this.createCandidate(relativePath));
		} catch {
			// Fallback: substring match
			return relativePaths
				.filter((p) => p.toLowerCase().includes(query.toLowerCase()))
				.slice(0, limit)
				.map((relativePath) => this.createCandidate(relativePath));
		}
	}

	private createCandidate(relativePath: string): FffFileCandidate {
		return {
			item: {
				relativePath,
				fileName: basename(relativePath),
				size: 0,
				modified: 0,
				accessFrecencyScore: 0,
				modificationFrecencyScore: 0,
				totalFrecencyScore: 0,
				gitStatus: "unknown",
			},
			score: {
				total: 0,
				baseScore: 0,
				filenameBonus: 0,
				specialFilenameBonus: 0,
				frecencyBoost: 0,
				distancePenalty: 0,
				currentFilePenalty: 0,
				comboMatchBoost: 0,
				exactMatch: false,
				matchType: "fuzzy",
			},
		};
	}

	private makeRelative(absolutePath: string): string {
		return normalizeSlashes(relative(this.basePath, absolutePath));
	}
}
