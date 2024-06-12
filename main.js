const { Plugin, PluginSettingTab, Setting, normalizePath } = require('obsidian');

module.exports = class CopyPreviousDayNotePlugin extends Plugin {
    async onload() {
        console.log('Copy Previous Day Note plugin loaded');

        // Default configuration
        this.settings = Object.assign({}, { maxDays: 7 });

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new CopyPreviousDayNoteSettingTab(this.app, this));

        // Ensure the daily notes plugin is loaded before overriding the command
        const dailyNotesPlugin = this.app.internalPlugins.getPluginById('daily-notes');
        if (!dailyNotesPlugin) {
            console.error('Daily Notes plugin is not available');
            return;
        }

        // Wait for the daily notes plugin to be fully initialized
        await dailyNotesPlugin.load();

        this.overrideDailyNoteCommand(dailyNotesPlugin);
    }

    overrideDailyNoteCommand(dailyNotesPlugin) {
        const checkCommandExists = () => {
            const originalCommand = this.app.commands.commands['daily-notes'];
            if (!originalCommand) {
                console.error('Original daily note command not found, retrying...');
                setTimeout(checkCommandExists, 100); // Retry after 100ms
                return;
            }

            console.log('Original daily note command found', originalCommand);

            // Directly override the command's callback
            const newCallback = async () => {
                console.log('Overridden daily note command executed');

                const moment = window.moment;
                const vault = this.app.vault;
                const dateFormat = dailyNotesPlugin.instance.options.format;
                const date = moment().format(dateFormat);

                // Get the folder path from the daily notes plugin settings
                const folderPath = dailyNotesPlugin.instance.options.folder;
                if (!folderPath) {
                    console.error('Daily Notes folder is not set in the settings');
                    return;
                }

                const newFilePath = normalizePath(`${folderPath}/${date}.md`);

                // Create directories if they don't exist
                await this.ensureDirectoryExists(newFilePath);

                // Check if the file already exists
                const existingFile = vault.getAbstractFileByPath(newFilePath);
                if (existingFile) {
                    console.log(`File already exists: ${newFilePath}`);
                    this.app.workspace.openLinkText(newFilePath, '/', false);
                    return;
                }

                let oldFilePath = '';
                let oldFileContent = '';
                let found = false;

                for (let i = 1; i <= this.settings.maxDays; i++) {
                    const previousDate = moment().subtract(i, 'days').format(dateFormat);
                    oldFilePath = normalizePath(`${folderPath}/${previousDate}.md`);
                    const oldFile = vault.getAbstractFileByPath(oldFilePath);
                    if (oldFile) {
                        oldFileContent = await vault.read(oldFile);
                        console.log(`Old file content read successfully from ${oldFilePath}`);
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    console.log(`No previous note found within ${this.settings.maxDays} days. Creating an empty note.`);
                    await vault.create(newFilePath, '');
                } else {
                    const filteredContent = this.removeCompletedTasks(oldFileContent);
                    console.log('Filtered content:', filteredContent);
                    await vault.create(newFilePath, filteredContent);
                    console.log('New daily note created successfully with filtered content');
                }

                this.app.workspace.openLinkText(newFilePath, '/', false);
            };

            this.app.commands.commands['daily-notes'].callback = newCallback;

            console.log('Daily note command overridden successfully');

            // Re-bind UI elements to use the new command callback
            setTimeout(() => this.rebindDailyNoteButton(newCallback), 1000);
        };

        checkCommandExists();
    }

    async ensureDirectoryExists(filePath) {
        const vault = this.app.vault;
        const dirPath = filePath.split('/').slice(0, -1).join('/');

        // Check if directory exists
        const folder = vault.getAbstractFileByPath(dirPath);
        if (!folder) {
            await vault.createFolder(dirPath);
            console.log(`Created directory: ${dirPath}`);
        }
    }

    rebindDailyNoteButton(newCallback) {
        // Find the button element by the specific aria-label
        const button = document.querySelector('div.clickable-icon[aria-label="Open today\'s daily note"]');
        if (button) {
            // Remove existing click event listeners (if any)
            button.replaceWith(button.cloneNode(true)); // Clone to remove all event listeners
            const newButton = document.querySelector('div.clickable-icon[aria-label="Open today\'s daily note"]');
            newButton.addEventListener('click', newCallback);
            console.log('Daily note button re-bound to new callback');
        } else {
            console.error('Daily note button not found in the UI');
        }
    }

    removeCompletedTasks(content) {
        const lines = content.split('\n');
        const result = [];
        let skip = false;
        const taskRegex = /^\s*-\s\[x\]/;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Replace tabs with 3 spaces
            line = line.replace(/\t/g, '   ');

            if (taskRegex.test(line)) {
                skip = true;
                console.log('Skipping completed task:', line);
                continue;
            }

            if (skip && /^\s+-\s/.test(line)) {
                console.log('Skipping nested task:', line);
                continue;
            } else {
                skip = false;
            }

            result.push(line);
        }

        return result.join('\n');
    }

    onunload() {
        console.log('Unloading Copy Previous Day Note plugin');
        // Optionally, restore the original command if necessary
    }

    async loadSettings() {
        this.settings = Object.assign({}, this.settings, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};

class CopyPreviousDayNoteSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for Copy Previous Day Note' });

        new Setting(containerEl)
            .setName('Maximum Days to Look Back')
            .setDesc('The maximum number of days (up to 30) to look back for a previous note')
            .addSlider(slider => slider
                .setLimits(1, 30, 1)
                .setValue(this.plugin.settings.maxDays)
                .onChange(async (value) => {
                    this.plugin.settings.maxDays = value;
                    await this.plugin.saveSettings();
                }));
    }
}
