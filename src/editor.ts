import type { KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions, TUI } from "@mariozechner/pi-tui";
import type { EditorTheme } from "@mariozechner/pi-tui";
import type { FffRuntime } from "./fff-runtime.ts";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
const MAX_FILE_RESULTS = 20;
const MAX_COMMAND_RESULTS = 40;

type CommandEntry = {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
};

function findLastDelimiter(text: string): number {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) return i;
	}
	return -1;
}

function isTokenStart(text: string, index: number): boolean {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

function findUnclosedQuoteStart(text: string): number | null {
	let inQuotes = false;
	let quoteStart = -1;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '"') {
			inQuotes = !inQuotes;
			if (inQuotes) quoteStart = i;
		}
	}
	return inQuotes ? quoteStart : null;
}

function extractAtPrefix(text: string): string | null {
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart !== null && quoteStart > 0 && text[quoteStart - 1] === "@" && isTokenStart(text, quoteStart - 1)) {
		return text.slice(quoteStart - 1);
	}

	const lastDelimiterIndex = findLastDelimiter(text);
	const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
	if (text[tokenStart] === "@") return text.slice(tokenStart);
	return null;
}

function parseAtPrefix(prefix: string): { rawQuery: string; isQuotedPrefix: boolean } {
	if (prefix.startsWith('@"')) return { rawQuery: prefix.slice(2), isQuotedPrefix: true };
	return { rawQuery: prefix.slice(1), isQuotedPrefix: false };
}

function normalizeInsertedPath(value: string): string {
	let normalized = value.trim();
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	if (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length >= 2) {
		normalized = normalized.slice(1, -1);
	}
	return normalized;
}

function toFileSuggestion(relativePath: string, label: string, description: string, isQuotedPrefix: boolean): AutocompleteItem {
	const path = relativePath.replace(/\\/g, "/");
	const needsQuotes = isQuotedPrefix || path.includes(" ");
	return {
		value: needsQuotes ? `@"${path}"` : `@${path}`,
		label,
		description,
	};
}

function toPromptOrSkillCommands(commands: CommandEntry[]): CommandEntry[] {
	return commands.filter((c) => c.source === "prompt" || c.source === "skill");
}

function getCommandSearchText(command: CommandEntry): string {
	const bareName = command.source === "skill" ? command.name.replace(/^skill:/, "") : command.name;
	return `${bareName} ${command.name} ${command.source} ${command.description ?? ""}`.trim();
}

export function buildDollarSuggestions(commands: CommandEntry[], query: string): AutocompleteItem[] {
	return fuzzyFilter(commands, query, getCommandSearchText)
		.slice(0, MAX_COMMAND_RESULTS)
		.map((command) => ({
			value: `/${command.name}`,
			label: `/${command.name}`,
			description: command.description ?? "",
		}));
}

class FffAutocompleteProvider implements AutocompleteProvider {
	private readonly baseProvider: AutocompleteProvider;
	private readonly runtime: FffRuntime;
	private readonly getCommands: () => CommandEntry[];

	constructor(baseProvider: AutocompleteProvider, runtime: FffRuntime, getCommands: () => CommandEntry[]) {
		this.baseProvider = baseProvider;
		this.runtime = runtime;
		this.getCommands = getCommands;
	}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<AutocompleteSuggestions | null> {
		const currentLine = lines[cursorLine] ?? "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const atPrefix = extractAtPrefix(textBeforeCursor);
		
		if (atPrefix) {
			if (options.signal.aborted) return null;

			const { rawQuery, isQuotedPrefix } = parseAtPrefix(atPrefix);
			try {
				const candidates = await this.runtime.searchFileCandidates(rawQuery, MAX_FILE_RESULTS);
				if (options.signal.aborted || candidates.length === 0) {
					return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return {
					prefix: atPrefix,
					items: candidates.map((candidate) =>
						toFileSuggestion(
							candidate.item.relativePath,
							candidate.item.fileName || candidate.item.relativePath,
							candidate.item.relativePath,
							isQuotedPrefix,
						)
					),
				};
			} catch {
				return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
			}
		}

		return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		void this.runtime.trackQuery(prefix, normalizeInsertedPath(item.value));
		return this.baseProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}

	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean {
		const candidate = this.baseProvider as AutocompleteProvider & {
			shouldTriggerFileCompletion?: (l: string[], line: number, col: number) => boolean;
		};
		return candidate.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
	}
}

export class FffEditor extends CustomEditor {
	private readonly runtime: FffRuntime;
	private readonly getCommands: () => CommandEntry[];

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		runtime: FffRuntime,
		getCommands: () => CommandEntry[],
	) {
		super(tui, theme, keybindings);
		this.runtime = runtime;
		this.getCommands = getCommands;
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		super.setAutocompleteProvider(new FffAutocompleteProvider(provider, this.runtime, this.getCommands));
	}
}
