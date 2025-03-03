// Copyright (C) 2025 Toit language
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import dotenv from 'dotenv';
dotenv.config();

import * as discordTranscripts from 'discord-html-transcripts';
import {
  ChannelType,
  Client,
  ClientUser,
  Collection,
  Events,
  ForumChannel,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  PermissionFlagsBits,
  PublicThreadChannel,
  TextChannel
} from 'discord.js';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { generateGuildIndex } from './index-generator';
import { sanitizeFilename } from './utils';

interface GuildConfig {
  guildName: string;
  channelsToProcess: string[];
}

interface ChannelToProcess {
  id: string;
  channel: GuildBasedChannel | PublicThreadChannel<true>;
  parentName: string | null;
}

interface TranscriptItem {
  filename: string;
  displayName: string;
  parentName: string | null;
  lastActivity: Date | null;
}

// Parse command line arguments.
function parseArgs(): { outputDir: string; configFiles: string[] } {
  const args = process.argv.slice(2);
  let outputDir = './transcripts';
  let configFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      if (i + 1 < args.length) {
        outputDir = args[i + 1];
        i++; // Skip next argument since we used it.
      } else {
        console.error('Error: Output directory path is missing');
        process.exit(1);
      }
    } else {
      // All non-flag arguments are treated as config files
      configFiles.push(args[i]);
    }
  }

  if (configFiles.length === 0) {
    console.error('Error: At least one configuration file must be specified');
    console.error('Usage: node index.js [-o output_directory] config_file.yaml [config_file2.yaml...]');
    process.exit(1);
  }

  return { outputDir, configFiles };
}

const { outputDir, configFiles } = parseArgs();

// Parse configuration files and build guild/channel mappings.
function parseConfigFiles(configFiles: string[]): GuildConfig[] {
  const guildConfigs: GuildConfig[] = [];

  for (const configFile of configFiles) {
    try {
      const fileContent = fs.readFileSync(configFile, 'utf8');
      const config = yaml.load(fileContent) as { guild?: string; channels?: string[] };

      if (!config.guild || !config.channels || !Array.isArray(config.channels)) {
        console.error(`Error: Invalid configuration in ${configFile}. Each config file must have 'guild' and 'channels' array.`);
        continue;
      }

      guildConfigs.push({
        guildName: config.guild,
        channelsToProcess: config.channels
      });
    } catch (error) {
      console.error(`Error reading or parsing ${configFile}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (guildConfigs.length === 0) {
    console.error('Error: No valid configuration files found');
    process.exit(1);
  }

  return guildConfigs;
}

const guildConfigs = parseConfigFiles(configFiles);

// Create output directory if it doesn't exist.
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Create Discord client with necessary intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Ensure guild directory exists and return the path.
function ensureGuildDirectory(outputDir: string, guildName: string): string {
  const safeGuildName = guildName.replace(/[^\w\s]/gi, '');
  const guildDir = path.join(outputDir, safeGuildName);

  if (!fs.existsSync(guildDir)) {
    fs.mkdirSync(guildDir, { recursive: true });
  }

  return guildDir;
}

// Fetch all threads from a forum channel with pagination.
async function fetchAllThreads(forumChannel: ForumChannel, active: boolean): Promise<Collection<string, PublicThreadChannel<true>>> {
  const activeStr = active ? 'active' : 'archived';
  const allThreads = new Collection<string, PublicThreadChannel<true>>();
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
      console.log(`Fetched ${fetchedThreads.threads.size} ${activeStr} threads from forum #${forumChannel.name} (batch ${fetchCount})`);

      // No more threads to fetch.
      if (fetchedThreads.threads.size === 0) {
        console.log(`No more threads to fetch from #${forumChannel.name}, breaking out of pagination loop`);
        break;
      }

      // Add fetched threads to our collection.
      fetchedThreads.threads.forEach((thread, threadId) => {
        allThreads.set(threadId, thread as PublicThreadChannel<true>);
      });

      // Find the oldest thread ID for pagination.
      let oldestSnowflake: string | null = null;
      for (const [threadId] of fetchedThreads.threads) {
        if (!oldestSnowflake || threadId < oldestSnowflake) {
          oldestSnowflake = threadId;
        }
      }

      // If we found an older thread ID, use it for the next page.
      if (oldestSnowflake && oldestSnowflake !== beforeId) {
        beforeId = oldestSnowflake;
        console.log(`Next pagination will fetch threads before ID: ${beforeId}`);
      } else {
        // If we didn't get a new oldest ID or it's the same as before, we're done.
        console.log(`No new thread IDs found or same as before, ending pagination for #${forumChannel.name}`);
        hasMoreThreads = false;
      }

      // Safety check: if we fetched fewer threads than the limit, we're probably done.
      if (fetchedThreads.threads.size < 100) {
        console.log(`Fetched fewer than limit (${fetchedThreads.threads.size} < 100), ending pagination`);
        hasMoreThreads = false;
      }

      // Safety check: bail out after 20 iterations to prevent infinite loops.
      if (fetchCount >= 20) {
        console.log(`Reached maximum fetch count (20), stopping pagination`);
        hasMoreThreads = false;
      }
    } catch (error) {
      console.error(`Error fetching thread batch from #${forumChannel.name}:`, error instanceof Error ? error.message : String(error));
      hasMoreThreads = false;
    }
  }

  console.log(`Completed pagination for #${forumChannel.name}, found ${allThreads.size} total ${activeStr} threads`);
  return allThreads;
}

// Check if a channel matches the configured patterns.
function doesChannelMatch(channel: GuildBasedChannel, pattern: string): boolean {
  return pattern === '*' || channel.name === pattern;
}

// Check if a channel should be processed based on configuration.
async function processChannels(
  guild: Guild,
  clientUser: ClientUser | null,
  channelsToProcessConfig: string[]
): Promise<ChannelToProcess[]> {
  console.log(`Processing guild: ${guild.name}`);

  // Array to store all channels and threads to process.
  const channelsToProcess: ChannelToProcess[] = [];

  try {
    // Fetch all channels.
    const channels = await guild.channels.fetch();

    for (const [channelId, channel] of channels) {
      // Skip if channel doesn't exist.
      if (!channel) continue;

      // Check for view channel permission.
      if (channel.guild && clientUser) {
        const permissions = channel.permissionsFor(clientUser);
        if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel)) {
          console.log(`Skipping private channel: #${channel.name}`);
          continue;
        }
      }

      // Check if this channel matches any of our patterns.
      const matchingPattern = channelsToProcessConfig.find(pattern => doesChannelMatch(channel, pattern));

      if (matchingPattern) {
        if (channel.type === ChannelType.GuildForum) {
          console.log(`Found matching forum channel: #${channel.name}`);

          try {
            const forumChannel = channel as ForumChannel;
            // Get ALL threads in the forum using pagination
            const activeThreads = await fetchAllThreads(forumChannel, true);
            const passiveThreads = await fetchAllThreads(forumChannel, false);
            const threads = new Collection([...activeThreads, ...passiveThreads]);
            console.log(`Found total of ${threads.size} threads in forum #${channel.name}`);

            // Add each thread to the processing list.
            for (const [threadId, thread] of threads) {
              channelsToProcess.push({
                id: threadId,
                channel: thread,
                parentName: channel.name
              });
            }
          } catch (threadsError) {
            console.error(`Error fetching threads for forum #${channel.name}:`, threadsError instanceof Error ? threadsError.message : String(threadsError));
          }
        }
        // If it's a regular text channel.
        else if (channel.isTextBased() && !channel.isThread()) {
          channelsToProcess.push({
            id: channelId,
            channel: channel,
            parentName: null
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error processing channels in guild ${guild.name}:`, error instanceof Error ? error.message : String(error));
  }

  return channelsToProcess;
}

// Log when the bot is ready.
client.once(Events.ClientReady, async (readyClient: Client) => {
  console.log(`Logged in as ${readyClient.user?.tag}`);

  try {
    // Process specified guilds.
    console.log('Generating transcripts for channels...');
    console.log('Looking for guilds in configuration files:', configFiles);

    // Get all guilds and filter for the ones we want.
    const allGuilds = client.guilds.cache;
    const guildsToProcess = allGuilds.filter(guild =>
      guildConfigs.some(config => guild.name.toLowerCase() === config.guildName.toLowerCase())
    );

    if (guildsToProcess.size === 0) {
      console.error('Error: None of the specified guilds were found');
      console.log('Available guilds:', [...allGuilds.values()].map(g => g.name).join(', '));
      client.destroy();
      process.exit(1);
    }

    console.log(`Found ${guildsToProcess.size} matching guild(s)`);

    let totalChannelsProcessed = 0;
    let skippedChannelsCount = 0;

    // Process each guild.
    for (const [guildId, guild] of guildsToProcess) {
      // Find the corresponding config for this guild.
      const guildConfig = guildConfigs.find(config => config.guildName.toLowerCase() === guild.name.toLowerCase());

      if (!guildConfig) {
        console.error(`Error: No configuration found for guild ${guild.name}`);
        continue;
      }

      // Create directory for this guild.
      const guildDir = ensureGuildDirectory(outputDir, guild.name);
      console.log(`Processing guild ${guild.name} into directory: ${guildDir}`);

      // Get all matching channels and forum threads.
      const channelsToProcess = await processChannels(guild, client.user, guildConfig.channelsToProcess);

      console.log(`Found ${channelsToProcess.length} matching channel(s)/thread(s) in ${guild.name}`);

      // Process each channel or thread.
      for (const { id, channel, parentName } of channelsToProcess) {
        const channelName = channel.name;
        const displayName = parentName ? `${parentName}/${channelName}` : channelName;

        console.log(`Generating transcript for: #${displayName}`);

        try {
          // Generate transcript for the channel or thread.
          const textBasedChannel = channel as TextChannel | PublicThreadChannel<true>;
          const attachment = await discordTranscripts.createTranscript(textBasedChannel, {
            filename: `${displayName}.html`,
            poweredBy: false,
            saveImages: true,
            footerText: "{number} messages in total",
            hydrate: true,
          });

          // Create a valid filename (no need for guild name prefix since it's in the directory).
          const safeChannelName = sanitizeFilename(displayName);

          // Save the transcript to the guild's directory.
          const filePath = path.join(guildDir, safeChannelName);

          // Access the attachment data directly.
          fs.writeFileSync(filePath, attachment.attachment as Buffer);

          console.log(`Transcript saved to: ${filePath}`);
          totalChannelsProcessed++;
        } catch (channelError) {
          console.error(`Error generating transcript for #${displayName}:`, channelError instanceof Error ? channelError.message : String(channelError));
          skippedChannelsCount++;
          // Continue to the next channel instead of failing.
          continue;
        }
      }

      // Generate index.html for the guild.
      const transcripts: TranscriptItem[] = channelsToProcess.map(({ id, channel, parentName }) => {
        const filename = `${parentName ? `${parentName}-` : ''}${channel.name}.html`;
        const displayName = `#${parentName ? `${parentName}/` : ''}${channel.name}`;
        let lastActivity = null;
        if (channel.isThread()) {
          const thread = channel as PublicThreadChannel<true>;
          lastActivity = thread.lastMessage?.createdAt || thread.archivedAt;
        }
        return {
          filename: filename,
          displayName: displayName,
          parentName,
          lastActivity: lastActivity,
        };
      });
      generateGuildIndex(guildDir, guild.name, transcripts);
    }

    console.log(`Successfully processed ${totalChannelsProcessed} channel(s)/thread(s)`);
    if (skippedChannelsCount > 0) {
      console.log(`Skipped ${skippedChannelsCount} inaccessible or problematic channel(s)`);
    }
    console.log(`Transcripts saved to: ${path.resolve(outputDir)}`);
  } catch (error) {
    console.error('An error occurred:', error instanceof Error ? error.message : String(error));
  } finally {
    // Disconnect the bot after processing.
    client.destroy();
    console.log('Bot disconnected.');
  }
});

// Login to Discord with the bot token.
client.login(process.env.DISCORD_TOKEN);
