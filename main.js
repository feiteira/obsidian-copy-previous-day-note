const { Plugin, PluginSettingTab, Setting, normalizePath } = require('obsidian');

module.exports = class CopyPreviousDayNotePlugin extends Plugin {
    DEBUG_ENABLED = false;  // Set this to true to enable debug logging

    debug(message) {
        if (this.DEBUG_ENABLED) {
            console.log(`[CopyPreviousDayNotePlugin] ${message}`);
        }
    }

    async onload() {
        this.debug('Copy Previous Day Note plugin loaded');

        // Default configuration
        this.settings = Object.assign({}, { maxDays: 7 });

        // Load settings
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new CopyPreviousDayNoteSettingTab(this.app, this));

        // Ensure the daily notes plugin is loaded before overriding the command
        const dailyNotesPlugin = this.app.internalPlugins.getPluginById('daily-notes');
        if (!dailyNotesPlugin) {
            this.debug('Daily Notes plugin is not available');
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
                this.debug('Original daily note command not found, retrying...');
                setTimeout(checkCommandExists, 100); // Retry after 100ms
                return;
            }

            this.debug('Original daily note command found');

            // Directly override the command's callback
            const newCallback = async () => {
                this.debug('Overridden daily note command executed');

                const moment = window.moment;
                const vault = this.app.vault;
                const { format, folder } = dailyNotesPlugin.instance.options;
                const date = moment();

                // Generate the full path for the new note
                const fileName = date.format(format) + '.md';
                const folderPath = this.parseCustomFolderPath(folder, date);
                const newFilePath = normalizePath(`${folderPath}/${fileName}`);

                this.debug(`Attempting to create new note at: ${newFilePath}`);

                await this.ensureDirectoryExists(newFilePath);

                const existingFile = vault.getAbstractFileByPath(newFilePath);
                if (existingFile) {
                    this.debug(`File already exists: ${newFilePath}`);
                    this.app.workspace.openLinkText(newFilePath, '/', false);
                    return;
                }

                let oldFileContent = '';
                let found = false;

                for (let i = 1; i <= this.settings.maxDays; i++) {
                    const previousDate = moment().subtract(i, 'days');
                    const prevFileName = previousDate.format(format) + '.md';
                    const prevFolderPath = this.parseCustomFolderPath(folder, previousDate);
                    const oldFilePath = normalizePath(`${prevFolderPath}/${prevFileName}`);
                    
                    const oldFile = vault.getAbstractFileByPath(oldFilePath);
                    if (oldFile) {
                        oldFileContent = await vault.read(oldFile);
                        this.debug(`Old file content read successfully from ${oldFilePath}`);
                        found = true;
                        break;
                    }
                }

                let newFileContent = '';
                if (!found) {
                    this.debug(`No previous note found within ${this.settings.maxDays} days. Creating an empty note.`);
                } else {
                    newFileContent = this.removeCompletedTasks(oldFileContent);
                    this.debug('Filtered content created');
                }

                try {
                    await vault.create(newFilePath, newFileContent);
                    this.debug('New daily note created successfully');
                    this.app.workspace.openLinkText(newFilePath, '/', false);
                } catch (error) {
                    this.debug('Failed to create new daily note: ' + error.message);
                    // You might want to show an error message to the user here
                }
            };

            this.app.commands.commands['daily-notes'].callback = newCallback;

            this.debug('Daily note command overridden successfully');

            // Re-bind UI elements to use the new command callback
            setTimeout(() => this.rebindDailyNoteButton(newCallback), 1000);
        };

        checkCommandExists();
    }

    parseCustomFolderPath(folderPath, date) {
        if (!folderPath) return '';

        const dateTokens = ['YYYY', 'YY', 'MM', 'M', 'DD', 'D', 'ddd', 'dddd', 'MMMM', 'MMM'];
        
        // Split the path into segments
        const segments = folderPath.split('/');
        
        // Process each segment
        const processedSegments = segments.map(segment => {
            // Check if the segment contains any date tokens
            if (dateTokens.some(token => segment.includes(token))) {
                // If it does, replace the tokens with formatted date
                return segment.replace(new RegExp(dateTokens.join('|'), 'g'), match => date.format(match));
            }
            // If it doesn't, return the segment as is
            return segment;
        });

        // Join the processed segments back into a path
        return processedSegments.join('/');
    }

    async ensureDirectoryExists(filePath) {
        const vault = this.app.vault;
        const dirPath = filePath.split('/').slice(0, -1).join('/');

        if (dirPath && dirPath !== '') {
            const folderObj = vault.getAbstractFileByPath(dirPath);
            if (!folderObj) {
                await vault.createFolder(dirPath);
                this.debug(`Created directory: ${dirPath}`);
            }
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
            this.debug('Daily note button re-bound to new callback');
        } else {
            this.debug('Daily note button not found in the UI');
        }
    }

    removeCompletedTasks(content) {
        const lines = content.split('\n');
        const result = [];
        let skip = 0;
        let level = 0;        
        const taskRegex = /^\s*[-\*]\s\[x\]/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if(line.trim()==''){//keep the empty lines, but nothing to do
                result.push(line);            
                continue;
            }
            
            level = line.replace(/\t/g, '   ').search(/\S/) + 1; // level of first non-white-space character
            // level is always > 0, so that skip = level means skip > 0

            if (taskRegex.test(line)) {
                if(skip == 0 || level < skip){
                    skip = level;
                }
                this.debug('Skipping completed task: ' + line);
                continue;
            }

            if (skip > 0 && level > skip) {
                this.debug('Skipping nested task: ' + line);
                continue;
            } else {
                skip = 0;
            }

            result.push(line);
        }

        return result.join('\n');
    }

    onunload() {
        this.debug('Unloading Copy Previous Day Note plugin');
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
