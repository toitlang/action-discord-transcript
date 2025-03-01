import * as fs from "fs";
import * as path from "path";

// Define interface for transcript object
interface Transcript {
  filename: string;
  displayName: string;
  lastActivity: Date | null;
}

// Function to generate index.html for a guild.
export function generateGuildIndex(
  guildName: string,
  threads: Transcript[]
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${guildName} - Discord Transcripts</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="icon" href="favicon.ico">
    <style>
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
                    <ul class="channels-list forum-channels">
                        ${threads
                          .map(
                            (thread) => `
                        <li class="channel-item">
                            <a href="./${thread.filename}">${
                              thread.displayName
                            }</a>
                            ${
                              thread.lastActivity
                                ? `<span class="timestamp" data-timestamp="${new Date(
                                    thread.lastActivity
                                  ).toISOString()}"></span>`
                                : ""
                            }
                        </li>
                        `
                          )
                          .join("")}
                    </ul>
                </div>
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
}
