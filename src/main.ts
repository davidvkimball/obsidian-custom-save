import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
} from "obsidian";
import "@total-typescript/ts-reset";
import "@total-typescript/ts-reset/dom";
import { MySettingManager } from "@/SettingManager";

const isMarkdownFile = (file: TAbstractFile | null) =>
	file instanceof TFile && file.extension === "md";

interface Command {
	id: string;
	name: string;
	editorCallback?: Function;
	editorCheckCallback?: Function;
}

export default class CustomSavePlugin extends Plugin {
	settingManager: MySettingManager;
	cachedCommands: Command[] = [];

	async onload() {
		// Initialize the setting manager
		this.settingManager = new MySettingManager(this);

		// Load the setting using setting manager
		await this.settingManager.loadSettings();

		// Cache commands by creating a temporary Markdown leaf
		const tempLeaf = this.app.workspace.getLeaf(true);
		try {
			await tempLeaf.setViewState({ type: "markdown", state: {} });
			this.cachedCommands = this.app.commands.listCommands().map((cmd) => ({
				id: cmd.id,
				name: cmd.name,
				editorCallback: cmd.editorCallback,
				editorCheckCallback: cmd.editorCheckCallback,
			}));
		} finally {
			tempLeaf.detach();
		}

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "save",
			name: "Save file",
			hotkeys: [
				{
					modifiers: ["Mod"],
					key: "s",
				},
			],
			editorCheckCallback: this.runSaveCommand.bind(this),
		});

		this.app.hotkeyManager.removeDefaultHotkeys("editor:save-file");

		this.addSettingTab(new CustomSaveSettingTab(this.app, this));
	}

	runSaveCommand = async (
		checking: boolean,
		editor: Editor,
		ctx: MarkdownView
	) => {
		if (!ctx.file) return;
		if (checking) {
			return isMarkdownFile(ctx.file);
		}

		// @ts-ignore
		await this.app.workspace.getActiveFileView()?.save();

		// for each command id in setting, run the command
		for (const commandId of this.settingManager.getSettings().commandIds) {
			const command = this.app.commands.findCommand(commandId);
			try {
				if (!command) {
					throw new Error(
						`custom save :command ${commandId} not found`
					);
				}
				if (command.editorCheckCallback) {
					command.editorCheckCallback(checking, editor, ctx);
					continue;
				}
				if (command.editorCallback) {
					command.editorCallback(editor, ctx);
					continue;
				}
			} catch (e) {
				console.error(e.message);
			}
		}

		// @ts-ignore
		await this.app.workspace.getActiveFileView()?.save();
	};
}

class CustomSaveSettingTab extends PluginSettingTab {
	plugin: CustomSavePlugin;
	settingItemMap = new Map<string, Setting>();

	constructor(app: App, plugin: CustomSavePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Get the setting using setting manager
		const setting = this.plugin.settingManager.getSettings();

		let currentValue = "";

		new Setting(containerEl)
			.setName("Add command")
			.addDropdown((dropdown) => {
				const commands = this.plugin.cachedCommands
					// Filter out commands already in settings and the plugin's own save command
					.filter(
						(command) =>
							!setting.commandIds.includes(command.id) &&
							command.id !== "custom-save:save"
					)
					.map((command) => ({
						label: command.name + (command.editorCallback || command.editorCheckCallback ? "" : " (non-editor)"),
						value: command.id,
					}));
				dropdown.addOptions(
					commands.reduce(
						(acc, cur) => {
							acc[cur.value] = cur.label;
							return acc;
						},
						{
							"": "",
						} as Record<string, string>
					)
				);
				dropdown.onChange(async (value) => {
					currentValue = value;
				});
			})
			.addButton((button) => {
				button.setButtonText("Add").onClick(() => {
					if (!currentValue) return;
					this.plugin.settingManager.updateSettings((setting) => {
						setting.value.commandIds.push(currentValue);
					});
					// Redraw the settings tab
					containerEl.empty();
					this.display();
				});
			});

		// for each setting
		setting.commandIds.forEach((commandId) => {
			// try to get the command
			const command = this.plugin.app.commands.findCommand(commandId);

			const setting = new Setting(containerEl)
				.setName(
					`${command?.name ?? commandId} ${
						!command ? "(not found)" : ""
					}`
				)
				.setDesc(command?.id ?? "")
				.addButton((button) => {
					button.setButtonText("Remove").onClick(() => {
						this.plugin.settingManager.updateSettings((setting) => {
							setting.value.commandIds =
								setting.value.commandIds.filter(
									(id) => id !== commandId
								);
						});
						// Redraw the settings tab
						containerEl.empty();
						this.display();
					});
				});

			if (!command) setting.nameEl.addClass("custom-save-error");
			this.settingItemMap.set(commandId, setting);
		});
	}
}