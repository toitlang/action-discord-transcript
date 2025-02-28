import * as fs from 'fs';
import * as path from 'path';
import { sanitizeFilename } from './utils';

// Define interface for transcript object
interface Transcript {
  filename: string;
  displayName: string;
  parentName: string | null;
  lastActivity: Date | null;
}

// Function to generate index.html for a guild.
export function generateGuildIndex(guildDir: string, guildName: string, transcripts: Transcript[]): void {
  // Group transcripts by parent channel for nesting.
  const groupedTranscripts: Record<string, Transcript[]> = {};
  const regularChannels: Transcript[] = [];

  // Organize transcripts into forum groups or regular channels.
  transcripts.forEach(transcript => {
    if (transcript.parentName) {
      if (!groupedTranscripts[transcript.parentName]) {
        groupedTranscripts[transcript.parentName] = [];
      }
      groupedTranscripts[transcript.parentName].push(transcript);
    } else {
      regularChannels.push(transcript);
    }
  });

  const indexPath = path.join(guildDir, 'index.html');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${guildName} - Discord Transcripts</title>
    <style>
        :root {
            --font-primary: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
            --font-display: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
            --background-primary: #36393f;
            --background-secondary: #2f3136;
            --background-secondary-alt: #292b2f;
            --background-tertiary: #202225;
            --background-accent: #4f545c;
            --background-floating: #18191c;
            --scrollbar-thin-thumb: #202225;
            --scrollbar-thin-track: transparent;
            --scrollbar-auto-thumb: #202225;
            --scrollbar-auto-track: #2e3338;
            --text-normal: #dcddde;
            --text-muted: #a3a6aa;
            --text-link: #00b0f4;
            --header-primary: #fff;
            --header-secondary: #b9bbbe;
            --channel-text: #8e9297;
            --channel-icon: #8e9297;
            --channel-text-hover: #dcddde;
            --channel-icon-hover: #dcddde;
            --channel-text-selected: #fff;
            --channel-icon-selected: #fff;
            --interactive-normal: #b9bbbe;
            --interactive-hover: #dcddde;
            --interactive-active: #fff;
            --discord-blurple: #5865F2;
        }

        body {
            font-family: var(--font-primary);
            background-color: var(--background-primary);
            color: var(--text-normal);
            margin: 0;
            padding: 0;
            overflow-x: hidden;
        }

        .app {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .guild-header {
            background-color: var(--background-tertiary);
            padding: 16px;
            box-shadow: 0 1px 0 rgba(4,4,5,0.2), 0 1.5px 0 rgba(6,6,7,0.05);
            z-index: 1;
        }

        .guild-header h1 {
            color: var(--header-primary);
            font-size: 24px;
            font-weight: 600;
            margin: 0;
        }

        .main-content {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .channels-container {
            width: 80%;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: var(--background-primary);
            overflow-y: auto;
        }

        .channel-category {
            margin-bottom: 24px;
        }

        .category-name {
            color: var(--header-secondary);
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 600;
            margin-bottom: 8px;
            padding-left: 4px;
            letter-spacing: 0.02em;
        }

        .channels-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .channel-item {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            margin: 2px 0;
            border-radius: 4px;
            color: var(--channel-text);
            text-decoration: none;
            transition: background-color 0.1s ease;
        }

        .channel-item:hover {
            background-color: var(--background-modifier-hover);
            color: var(--channel-text-hover);
        }

        .channel-item a {
            color: inherit;
            text-decoration: none;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .channel-hash {
            margin-right: 6px;
            font-size: 20px;
            color: var(--channel-icon);
        }

        .forum-channels {
            margin-left: 20px;
        }

        .timestamp {
            font-size: 11px;
            color: var(--text-muted);
            margin-left: 8px;
        }

        .forum-header {
            display: flex;
            align-items: center;
            color: var(--header-secondary);
            font-weight: 500;
            padding: 6px 8px;
            cursor: pointer;
            border-radius: 4px;
        }

        .forum-header:hover {
            background-color: var(--background-modifier-hover);
            color: var(--channel-text-hover);
        }

        .forum-title {
            display: flex;
            align-items: center;
        }

        .forum-icon {
            margin-right: 6px;
        }
    </style>
</head>
<body>
    <div class="app">
        <div class="guild-header">
            <h1>${guildName} Discord Transcripts</h1>
        </div>

        <div class="main-content">
            <div class="channels-container">
                <div class="channel-category">
                    <div class="category-name">Channels</div>
                    <ul class="channels-list">
                        ${regularChannels.map(channel => `
                        <li class="channel-item">
                            <span class="channel-hash">#</span>
                            <a href="./${sanitizeFilename(channel.filename)}">${channel.displayName.replace('#', '')}</a>
                        </li>
                        `).join('')}
                    </ul>
                </div>

                ${Object.entries(groupedTranscripts).map(([forumName, threads]) => `
                <div class="channel-category">
                    <div class="forum-header">
                        <div class="forum-title">
                            <span class="forum-icon">📋</span>
                            ${forumName}
                        </div>
                    </div>
                    <ul class="channels-list forum-channels">
                        ${threads
                            .sort((a, b) => {
                                // Sort by lastActivity timestamp (most recent first)
                                // If no timestamp available, put at the bottom
                                if (!a.lastActivity) return 1;
                                if (!b.lastActivity) return -1;
                                return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
                            })
                            .map(thread => `
                        <li class="channel-item">
                            <span class="channel-hash">#</span>
                            <a href="./${sanitizeFilename(thread.filename)}">${thread.displayName.split('/')[1]}</a>
                            ${thread.lastActivity ? `<span class="timestamp" data-timestamp="${new Date(thread.lastActivity).toISOString()}"></span>` : ''}
                        </li>
                        `).join('')}
                    </ul>
                </div>
                `).join('')}
            </div>
        </div>
        <div><span class="timestamp" data-timestamp="${new Date().toLocaleString()}"> Generated: </span></div>
    </div>
    <script>
      document.querySelectorAll(".timestamp").forEach(el => {
        const rawTimestamp = el.getAttribute("data-timestamp");
        if (rawTimestamp) {
          el.textContent += new Date(rawTimestamp).toLocaleString();
        }
      });
    </script>
</body>
</html>`;

  fs.writeFileSync(indexPath, html);
  console.log(`Generated index.html for guild ${guildName}.`);
}
