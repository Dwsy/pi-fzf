import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FffEditor } from "./editor.ts";
import { FffRuntime } from "./fff-runtime.ts";
import { isEnabled, isFeatureEnabled, loadConfig } from "./config.ts";
import { registerFzfCommand } from "./config-ui.ts";

export default function (pi: ExtensionAPI) {
	let runtime: FffRuntime | null = null;

	// Register /fzf command
	registerFzfCommand(pi);

	pi.on("session_start", async (_event, ctx) => {
		loadConfig();

		runtime?.dispose();

		if (!isEnabled()) {
			return;
		}

		runtime = new FffRuntime(ctx.cwd);

		// Only set editor component if autocomplete is enabled
		if (isFeatureEnabled("atAutocomplete") || isFeatureEnabled("commandAutocomplete")) {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => new FffEditor(tui, theme, keybindings, runtime!, () => pi.getCommands()));
		}
	});

	pi.on("session_shutdown", async () => {
		runtime?.dispose();
		runtime = null;
	});
}
