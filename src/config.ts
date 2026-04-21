import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type FeatureKey = "atAutocomplete" | "commandAutocomplete";

export type FzfConfig = {
	enabled: boolean;
	features: Record<FeatureKey, boolean>;
};

const CONFIG_KEY = "pi-fzf-config";
const DEFAULT_CONFIG: FzfConfig = {
	enabled: true,
	features: {
		atAutocomplete: true,
		commandAutocomplete: true,
	},
};

let currentConfig: FzfConfig = { ...DEFAULT_CONFIG };

export function loadConfig(): void {
	try {
		const stored = globalThis.localStorage?.getItem(CONFIG_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as Partial<FzfConfig>;
			currentConfig = {
				enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
				features: {
					atAutocomplete: parsed.features?.atAutocomplete ?? DEFAULT_CONFIG.features.atAutocomplete,
					commandAutocomplete: parsed.features?.commandAutocomplete ?? DEFAULT_CONFIG.features.commandAutocomplete,
				},
			};
		}
	} catch {
		currentConfig = { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(): void {
	try {
		globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify(currentConfig));
	} catch {
		// ignore
	}
}

export function getConfig(): FzfConfig {
	return { ...currentConfig };
}

export function isEnabled(): boolean {
	return currentConfig.enabled;
}

export function isFeatureEnabled(feature: FeatureKey): boolean {
	return currentConfig.enabled && currentConfig.features[feature];
}

export function setFeature(feature: FeatureKey, value: boolean): void {
	currentConfig.features[feature] = value;
	saveConfig();
}

export function setEnabled(value: boolean): void {
	currentConfig.enabled = value;
	saveConfig();
}
