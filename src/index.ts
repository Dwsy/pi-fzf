import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FffEditor } from "./editor.ts";
import { FffRuntime } from "./fff-runtime.ts";

export default function (pi: ExtensionAPI) {
	let runtime: FffRuntime | null = null;

	pi.on("session_start", async (_event, ctx) => {
		runtime?.dispose();
		runtime = new FffRuntime(ctx.cwd);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new FffEditor(tui, theme, keybindings, runtime!, () => pi.getCommands()));
	});

	pi.on("session_shutdown", async () => {
		runtime?.dispose();
		runtime = null;
	});
}
