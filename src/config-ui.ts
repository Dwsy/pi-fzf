import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	loadConfig,
	saveConfig,
	getConfig,
	isEnabled,
	isFeatureEnabled,
	setEnabled,
	setFeature,
	type FeatureKey,
} from "./config.ts";

export type { FeatureKey };

export const FEATURE_DEFINITIONS: Array<{ id: FeatureKey; label: string; description: string }> = [
	{
		id: "atAutocomplete",
		label: "@ File Autocomplete",
		description: "Enable @ prefix for fuzzy file search in editor",
	},
	{
		id: "commandAutocomplete",
		label: "#/$ Command Autocomplete",
		description: "Enable # and $ prefix for command/prompt/skill search",
	},
];

export function buildFeatureReport(): string {
	const config = getConfig();
	const lines: string[] = [];
	lines.push("pi-fzf config:");
	lines.push(`  enabled: ${config.enabled}`);
	for (const feature of FEATURE_DEFINITIONS) {
		const enabled = config.features[feature.id] ? "✓" : "✗";
		lines.push(`  ${enabled} ${feature.label}`);
	}
	return lines.join("\n");
}

export function registerFzfCommand(pi: ExtensionAPI): void {
	pi.registerCommand("fzf", {
		description: "Configure pi-fzf settings",
		handler: async (_args, ctx: ExtensionContext) => {
			await ctx.ui.custom((tui, theme, _kb, done) => {
				loadConfig();
				let selectedIndex = 0;
				let cachedLines: string[] | undefined;
				const draft = { ...getConfig() };

				const refresh = () => {
					cachedLines = undefined;
					tui.requestRender();
				};

				return {
					render(width: number) {
						if (cachedLines) return cachedLines;
						const lines: string[] = [];
						const add = (text: string) => lines.push(truncateToWidth(text, width));

						add(theme.fg("accent", theme.bold("pi-fzf settings")));
						add(theme.fg("dim", "Space toggles • Enter saves • Esc cancels"));
						lines.push("");

						// Master toggle
						const masterMarker = draft.enabled ? "[x]" : "[ ]";
						const masterSelected = selectedIndex === 0;
						const masterPrefix = masterSelected ? theme.fg("accent", "> ") : "  ";
						add(`${masterPrefix}${theme.fg(draft.enabled ? "accent" : "dim", masterMarker)} ${theme.bold("Enable pi-fzf")}`);

						// Feature toggles
						for (let i = 0; i < FEATURE_DEFINITIONS.length; i += 1) {
							const feature = FEATURE_DEFINITIONS[i]!;
							const selected = i + 1 === selectedIndex;
							const checked = draft.features[feature.id];
							const marker = checked ? "[x]" : "[ ]";
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const label = `${marker} ${feature.label}`;
							add(selected ? `${prefix}${theme.fg("accent", label)}` : `${prefix}${theme.fg("text", label)}`);
							add(`    ${theme.fg("muted", feature.description)}`);
						}

						lines.push("");
						const activeCount = Object.values(draft.features).filter(Boolean).length;
						add(theme.fg("dim", `Active features: ${draft.enabled ? activeCount : 0}/${FEATURE_DEFINITIONS.length}`));
						cachedLines = lines;
						return lines;
					},
					invalidate() {
						cachedLines = undefined;
					},
					handleInput(data: string) {
						const itemCount = 1 + FEATURE_DEFINITIONS.length;

						if (matchesKey(data, Key.up)) {
							selectedIndex = Math.max(0, selectedIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							selectedIndex = Math.min(itemCount - 1, selectedIndex + 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.space) || data === " ") {
							if (selectedIndex === 0) {
								draft.enabled = !draft.enabled;
							} else {
								const feature = FEATURE_DEFINITIONS[selectedIndex - 1]?.id;
								if (feature) {
									draft.features[feature] = !draft.features[feature];
								}
							}
							refresh();
							return;
						}
						if (matchesKey(data, Key.enter)) {
							setEnabled(draft.enabled);
							for (const feature of FEATURE_DEFINITIONS) {
								setFeature(feature.id, draft.features[feature.id]);
							}
							ctx.ui.notify("pi-fzf settings saved", "info");
							done(undefined);
							return;
						}
						if (matchesKey(data, Key.escape)) {
							ctx.ui.notify("pi-fzf settings unchanged", "info");
							done(undefined);
						}
					},
				};
			});
		},
	});
}
