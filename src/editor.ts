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

function extractPrefix(text: string): { type: "@" | "$" | null; rawQuery: string; isQuotedPrefix: boolean } {
	// Check for @ prefix
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart !== null && quoteStart > 0 && text[quoteStart - 1] === "@" && isTokenStart(text, quoteStart - 1)) {
		return { type: "@", rawQuery: text.slice(quoteStart - 1), isQuotedPrefix: true };
	}

	const lastDelimiterIndex = findLastDelimiter(text);
	const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
	const token = text.slice(tokenStart);

	// Check for @ prefix (without quotes)
	if (token.startsWith("@") && !token.startsWith("@\"")) {
		return { type: "@", rawQuery: token, isQuotedPrefix: false };
	}

	// Check for $ prefix
	if (token.startsWith("$")) {
		return { type: "$", rawQuery: token.slice(1), isQuotedPrefix: false };
	}

	return { type: null, rawQuery: "", isQuotedPrefix: false };
}

function normalizeInsertedPath(value: string): string {
	let normalized = value.trim();
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	if (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length >= 2) {
		normalized = normalized.slice(1, -1);
	}
	return normalized;
}

function toFileSuggestion(relativePath: string, label: string, description: string): AutocompleteItem {
	const path = relativePath.replace(/\\/g, "/");
	const needsQuotes = path.includes(" ");
	return {
		value: needsQuotes ? `@"${path}"` : `@${path}`,
		label,
		description,
	};
}

function getCommandSearchText(command: CommandEntry): string {
	const bareName = command.source === "skill" ? command.name.replace(/^skill:/, "") : command.name;
	return `${bareName} ${command.name} ${command.source} ${command.description ?? ""}`.trim();
}

function buildCommandSuggestions(commands: CommandEntry[], query: string): AutocompleteItem[] {
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
		const { type, rawQuery, isQuotedPrefix } = extractPrefix(textBeforeCursor);

		// Handle @ prefix - file autocomplete
		if (type === "@") {
			if (options.signal.aborted) return null;

			try {
				const candidates = await this.runtime.searchFileCandidates(rawQuery.slice(1), MAX_FILE_RESULTS);
				if (options.signal.aborted || candidates.length === 0) {
					return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return {
					prefix: rawQuery,
					items: candidates.map((candidate) =>
						toFileSuggestion(
							candidate.item.relativePath,
							candidate.item.fileName || candidate.item.relativePath,
							candidate.item.relativePath,
						)
					),
				};
			} catch {
				return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
			}
		}

		// Handle $ prefix - command autocomplete
		if (type === "$") {
			if (options.signal.aborted) return null;

			const commands = this.getCommands().filter((c) => c.source === "prompt" || c.source === "skill");
			if (commands.length === 0) {
				return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const items = buildCommandSuggestions(commands, rawQuery);
			if (options.signal.aborted || items.length === 0) {
				return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				prefix: rawQuery,
				items,
			};
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
		// Track file selections for @ prefix
		if (prefix.startsWith("@")) {
			void this.runtime.trackQuery(prefix, normalizeInsertedPath(item.value));
		}
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
