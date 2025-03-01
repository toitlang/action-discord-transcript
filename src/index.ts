import dotenv from "dotenv";
dotenv.config();

import * as discordTranscripts from "discord-html-transcripts";
import {
  ChannelType,
  Client,
  ClientUser,
  Events,
  ForumChannel,
  GatewayIntentBits,
  Guild,
  PublicThreadChannel,
} from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { generateGuildIndex } from "./index-generator";

interface GuildConfig {
  guildName: string;
  channelsToProcess: string[];
}

type HelpThread = PublicThreadChannel<true>;

interface TranscriptItem {
  filename: string;
  displayName: string;
  isArchived: boolean;
  lastActivity: Date | null;
}

function usage() {
  console.log("Usage: node index.js [-o output_directory] guild_id");
  process.exit(1);
}

// Parse command line arguments.
function parseArgs(): { outputDir: string; guildId: string } {
  const args = process.argv.slice(2);
  let outputDir = "./transcripts";
  let guildId: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      if (i + 1 < args.length) {
        outputDir = args[i + 1];
        i++; // Skip next argument since we used it.
      } else {
        console.error("Error: Output directory path is missing");
        process.exit(1);
      }
    } else if (!guildId) {
      guildId = args[i];
    } else {
      usage();
    }
  }

  if (!guildId) {
    console.error("Error: Missing guild id");
    usage();
    throw "UNREACHABLE";
  }

  return { outputDir, guildId };
}

const { outputDir, guildId } = parseArgs();

// Create Discord client with necessary intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Fetch all threads from the forum channel with pagination.
async function fetchAllThreads(
  forumChannel: ForumChannel,
  active: boolean
): Promise<Array<HelpThread>> {
  const activeStr = active ? "active" : "archived";
  const helpThreads = new Array<HelpThread>();
  let hasMoreThreads = true;
  let beforeId: string | null = null;
  let fetchCount = 0;

  while (hasMoreThreads) {
    try {
      fetchCount++;
      // Set pagination options
      const options: {
        limit: number;
        archived?: Record<string, never>;
        before?: string;
      } = {
        limit: 100,
      };
      if (!active) options.archived = {};
      if (beforeId) options.before = beforeId;

      const fetchedThreads = await forumChannel.threads.fetch(options);
      console.log(
        `Fetched ${fetchedThreads.threads.size} ${activeStr} threads from forum #${forumChannel.name} (batch ${fetchCount})`
      );

      // No more threads to fetch
      if (fetchedThreads.threads.size === 0) {
        console.log(
          `No more threads to fetch from #${forumChannel.name}, breaking out of pagination loop`
        );
        break;
      }

      // Add fetched threads to our collection
      fetchedThreads.threads.forEach((thread, threadId) => {
        helpThreads.push(thread as HelpThread);
      });

      // Find the oldest thread ID for pagination
      let oldestSnowflake: string | null = null;
      for (const [threadId] of fetchedThreads.threads) {
        if (!oldestSnowflake || threadId < oldestSnowflake) {
          oldestSnowflake = threadId;
        }
      }

      // If we found an older thread ID, use it for the next page
      if (oldestSnowflake && oldestSnowflake !== beforeId) {
        beforeId = oldestSnowflake;
        console.log(
          `Next pagination will fetch threads before ID: ${beforeId}`
        );
      } else {
        // If we didn't get a new oldest ID or it's the same as before, we're done
        console.log(
          `No new thread IDs found or same as before, ending pagination for #${forumChannel.name}`
        );
        hasMoreThreads = false;
      }

      // Safety check: if we fetched fewer threads than the limit, we're probably done
      if (fetchedThreads.threads.size < 100) {
        console.log(
          `Fetched fewer than limit (${fetchedThreads.threads.size} < 100), ending pagination`
        );
        hasMoreThreads = false;
      }

      // Safety check: bail out after 20 iterations to prevent infinite loops
      if (fetchCount >= 20) {
        console.log(`Reached maximum fetch count (20), stopping pagination`);
        hasMoreThreads = false;
      }
    } catch (error) {
      console.error(
        `Error fetching thread batch from #${forumChannel.name}:`,
        error instanceof Error ? error.message : String(error)
      );
      hasMoreThreads = false;
    }
  }

  console.log(
    `Completed pagination for #${forumChannel.name}, found ${helpThreads.length} total ${activeStr} threads`
  );
  return helpThreads;
}

async function processHelpChannel(
  guild: Guild,
  clientUser: ClientUser | null
): Promise<HelpThread[]> {
  console.log(`Processing guild: ${guild.name}`);

  try {
    // Fetch all channels and find the help channel.
    const channels = await guild.channels.fetch();

    for (const [channelId, channel] of channels) {
      // Skip if channel doesn't exist.
      if (!channel) continue;
      if (channel.name != "help") continue;
      if (channel.type != ChannelType.GuildForum) continue;

      const forumChannel = channel as ForumChannel;
      // Get ALL threads in the forum using pagination
      const activeThreads = await fetchAllThreads(forumChannel, true);
      const passiveThreads = await fetchAllThreads(forumChannel, false);
      const helpThreads = activeThreads.concat(passiveThreads);
      console.log(
        `Found total of ${helpThreads.length} threads in forum #${channel.name}`
      );
      return helpThreads;
    }
  } catch (error) {
    console.error(
      `Error processing channels in guild ${guild.name}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
  throw "Could not find help channel";
}

// Function to sanitize names so they can be used as filenames.
function sanitizeThreadName(name: string): string {
  const sanitized = name.replace(/[^\w\s-]/gi, "-");
  return sanitized;
}

async function processGuild(
  guild: Guild,
  clientUser: ClientUser | null
): Promise<void> {
  const threads = await processHelpChannel(guild, client.user);

  // Create output directory if it doesn't exist.
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const index: TranscriptItem[] = [];

  let failed = 0;
  for (const thread of threads) {
    const displayName = thread.name;
    console.log(`Generating transcript for thread: ${displayName}`);

    try {
      // Create a valid filename.
      const safeThreadName = sanitizeThreadName(displayName);
      const filename = `${thread.id}-${safeThreadName}.html`;

      // Generate transcript for the thread.
      const attachment = await discordTranscripts.createTranscript(thread, {
        filename: filename,
        poweredBy: false,
        saveImages: true,
        footerText: "{number} messages in total",
        hydrate: true,
      });

      // Save the transcript to the output directory.
      const filePath = path.join(outputDir, filename);

      // Access the attachment data directly.
      fs.writeFileSync(filePath, attachment.attachment as Buffer);
      const lastActivity = thread.lastMessage?.createdAt || thread.archivedAt;
      index.push({
        filename: filename,
        displayName: displayName,
        isArchived: thread.archived || false,
        lastActivity: lastActivity,
      });

      console.log(`Transcript saved to: ${filePath}`);
    } catch (threadError) {
      failed++;
      console.error(
        `Error generating transcript for thread: ${displayName}:`,
        threadError instanceof Error ? threadError.message : String(threadError)
      );
      // Continue to the next thread instead of failing.
      continue;
    }
  }

  const successful = threads.length - failed;
  console.log(`Successfully processed ${successful} thread(s)`);
  if (failed > 0) {
    console.error(`Failed to process ${failed} thread(s)`);
  }
  console.log(`Transcripts saved to: ${path.resolve(outputDir)}`);

  // Create the index.
  const sortedIndex = index.sort((a, b) => {
    // Sort by lastActivity timestamp (most recent first)
    // If no timestamp available, put at the bottom
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return (
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  });

  const indexHtml = generateGuildIndex(guild.name, sortedIndex);
  const indexPath = path.join(outputDir, "index.html");
  fs.writeFileSync(indexPath, indexHtml);
  // Copy the stylesheet to the output directory.
  const stylesPath = path.join(outputDir, "styles.css");
  fs.copyFileSync(path.join(__dirname, "styles.css"), stylesPath);
  console.log(`Generated index.html for guild ${guild.name}.`);

  // Emit the index.json file.
  const indexJsonPath = path.join(outputDir, "index.json");
  fs.writeFileSync(indexJsonPath, JSON.stringify(sortedIndex, null, 2));
  console.log(`Generated index.json for guild ${guild.name}.`);
}

client.once(Events.ClientReady, async (readyClient: Client) => {
  console.log(`Logged in as ${readyClient.user?.tag}`);

  try {
    // Process specified guilds.
    console.log("Generating transcripts for channels...");
    console.log("Looking for guild:", guildId);

    const guild = await client.guilds.fetch(guildId);
    console.log(`Found guild: ${guild.name}`);

    await processGuild(guild, client.user);
  } catch (error) {
    console.error(
      "An error occurred:",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    // Disconnect the bot after processing.
    client.destroy();
    console.log("Bot disconnected.");
  }
});

// Login to Discord with the bot token.
client.login(process.env.DISCORD_TOKEN);
