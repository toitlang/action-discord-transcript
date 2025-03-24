// Copyright (C) 2025 Toit contributors
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import * as core from '@actions/core'

import * as discordTranscripts from 'discord-html-transcripts'
import {
  ChannelType,
  Client,
  Events,
  FetchArchivedThreadOptions,
  ForumChannel,
  GatewayIntentBits,
  Guild,
  PublicThreadChannel
} from 'discord.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { generateGuildIndex } from './index-generator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DISCORD_TOKEN = core.getInput('discord-token')
const GUILD_ID = core.getInput('guild-id')
const TRANSCRIPT_DIR = core.getInput('transcript-directory')

if (!DISCORD_TOKEN) {
  throw new Error('Missing required input: discord-token')
}
if (!GUILD_ID) {
  throw new Error('Missing required input: guild-id')
}
if (!TRANSCRIPT_DIR) {
  throw new Error('Missing required input: transcript-directory')
}

type HelpThread = PublicThreadChannel<true>

interface TranscriptItem {
  filename: string
  displayName: string
  isArchived: boolean
  lastActivity: Date | null
}

type Index = { [key: string]: TranscriptItem }

// Create Discord client with necessary intents.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

async function fetchActiveThreads(
  forumChannel: ForumChannel
): Promise<Array<HelpThread>> {
  const helpThreads = new Array<HelpThread>()
  try {
    const fetched = await forumChannel.threads.fetchActive()
    console.log(
      `Fetched ${fetched.threads.size} active threads from forum #${forumChannel.name}`
    )
    fetched.threads.forEach((thread) => {
      helpThreads.push(thread as HelpThread)
    })
  } catch (error) {
    console.error(
      `Error fetching active threads from #${forumChannel.name}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
  return helpThreads
}

// Fetch all threads from the forum channel with pagination.
async function fetchArchivedThreads(
  forumChannel: ForumChannel,
  cutoffDate: Date | undefined
): Promise<Array<HelpThread>> {
  const helpThreads = new Array<HelpThread>()
  let beforeId: string | undefined = undefined

  while (true) {
    try {
      const options: FetchArchivedThreadOptions = { limit: 100 }
      if (beforeId) options.before = beforeId

      const fetched = await forumChannel.threads.fetchArchived(options)
      console.log(
        `Fetched ${fetched.threads.size} archived threads from forum #${forumChannel.name}`
      )
      // No more threads to fetch.
      if (fetched.threads.size === 0) break

      // Add fetched threads to our collection.
      const fetchedThreads = new Array<HelpThread>()
      fetched.threads.forEach((thread) => {
        fetchedThreads.push(thread as HelpThread)
      })

      // Sort the fetched threads.
      // This shouldn't be necessary, but can't hurt.
      fetchedThreads.sort(
        (a, b) => (b.archiveTimestamp ?? 0) - (a.archiveTimestamp ?? 0)
      )

      helpThreads.push(...fetchedThreads)

      const newestThread = fetchedThreads[0]

      // If the newest thread is older than the cutoff date, we're done.
      if (
        cutoffDate &&
        newestThread.archivedAt &&
        newestThread.archivedAt < cutoffDate
      ) {
        console.log(
          `Newest thread is older than cutoff date, ending pagination for #${forumChannel.name}`
        )
        break
      }

      const oldestThread = fetchedThreads[fetchedThreads.length - 1]
      beforeId = oldestThread.id

      if (!fetched.hasMore) {
        console.log(
          `No more archived threads to fetch, ending pagination for #${forumChannel.name}`
        )
        break
      }
    } catch (error) {
      console.error(
        `Error fetching thread batch from #${forumChannel.name}:`,
        error instanceof Error ? error.message : String(error)
      )
      break
    }
  }

  console.log(
    `Completed pagination for #${forumChannel.name}, found ${helpThreads.length} total archived threads`
  )
  return helpThreads
}

async function processHelpChannel(
  guild: Guild,
  oldIndex: Index | undefined
): Promise<HelpThread[]> {
  console.log(`Processing guild: ${guild.name}`)

  try {
    // Fetch all channels and find the help channel.
    const channels = await guild.channels.fetch()

    for (const [, channel] of channels) {
      // Skip if channel doesn't exist.
      if (!channel) continue
      if (channel.name != 'help') continue
      if (channel.type != ChannelType.GuildForum) continue

      const forumChannel = channel as ForumChannel
      const activeThreads = await fetchActiveThreads(forumChannel)

      // Fetch the last message for each active thread.
      for (const thread of activeThreads) {
        try {
          await thread.messages.fetch({ limit: 1 })
        } catch (error) {
          console.error(
            `Error fetching messages for thread ${thread.name} (${thread.id}):`,
            error instanceof Error ? error.message : String(error)
          )
        }
      }

      let cutOffDate: Date | undefined = undefined
      if (oldIndex) {
        // Find the most recent archived thread in the index.
        for (const threadId in oldIndex) {
          const thread = oldIndex[threadId]
          if (thread.isArchived && thread.lastActivity) {
            if (!cutOffDate || thread.lastActivity > cutOffDate) {
              cutOffDate = thread.lastActivity
            }
          }
        }
      }

      const passiveThreads = await fetchArchivedThreads(
        forumChannel,
        cutOffDate
      )
      const helpThreads = activeThreads.concat(passiveThreads)
      console.log(
        `Found total of ${helpThreads.length} threads in forum #${channel.name}`
      )
      return helpThreads
    }
  } catch (error) {
    console.error(
      `Error processing channels in guild ${guild.name}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
  throw 'Could not find help channel'
}

async function processGuild(guild: Guild): Promise<void> {
  let oldIndex: Index = {}
  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    // Create output directory if it doesn't exist.
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true })
  } else {
    // Try to read the old index.json file.
    const oldIndexJsonPath = path.join(TRANSCRIPT_DIR, 'index.json')
    if (fs.existsSync(oldIndexJsonPath)) {
      const oldIndexJson = fs.readFileSync(oldIndexJsonPath, 'utf8')
      oldIndex = JSON.parse(oldIndexJson, (key, value) => {
        if (key === 'lastActivity') {
          return value ? new Date(value) : null
        }
        return value
      })
    }
  }

  const threads = await processHelpChannel(guild, oldIndex)

  const index: Index = {}

  let failed = 0
  for (const thread of threads) {
    const displayName = thread.name
    const filename = `${thread.id}.html`
    const lastActivity = thread.lastMessage?.createdAt || thread.archivedAt

    const newEntry: TranscriptItem = {
      filename: filename,
      displayName: displayName,
      isArchived: thread.archived || false,
      lastActivity: lastActivity
    }
    const oldEntry = oldIndex[thread.id]
    if (oldEntry) {
      // If the existing entry is the same, skip the thread.
      if (
        oldEntry.filename === newEntry.filename &&
        oldEntry.displayName === newEntry.displayName &&
        oldEntry.isArchived === newEntry.isArchived &&
        oldEntry.lastActivity?.toISOString() ===
          newEntry.lastActivity?.toISOString()
      ) {
        console.log(`Skipping unchanged thread: ${displayName}`)
        index[thread.id] = oldEntry
        continue
      }
    }

    console.log(`Generating transcript for thread: ${displayName}`)

    try {
      // Generate transcript for the thread.
      const attachment = await discordTranscripts.createTranscript(thread, {
        filename: filename,
        poweredBy: false,
        saveImages: true,
        footerText: '{number} messages in total',
        hydrate: true
      })

      // Save the transcript to the output directory.
      const filePath = path.join(TRANSCRIPT_DIR, filename)

      // Access the attachment data directly.
      fs.writeFileSync(filePath, attachment.attachment as Buffer)
      if (oldEntry && oldEntry.filename != filename) {
        // Delete the old file if the filename changed.
        const oldFilePath = path.join(TRANSCRIPT_DIR, oldEntry.filename)
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath)
          console.log(`Deleted old transcript: ${oldEntry.filename}`)
        }
      }

      console.log(`Transcript saved to: ${filePath}`)
      index[thread.id] = newEntry
    } catch (threadError) {
      failed++
      console.error(
        `Error generating transcript for thread: ${displayName}:`,
        threadError instanceof Error ? threadError.message : String(threadError)
      )
      // Continue to the next thread instead of failing.
      continue
    }
  }

  const successful = threads.length - failed
  console.log(`Successfully processed ${successful} thread(s)`)
  if (failed > 0) {
    console.error(`Failed to process ${failed} thread(s)`)
  }
  console.log(`Transcripts saved to: ${path.resolve(TRANSCRIPT_DIR)}`)

  // Add the old index entries to the new index.
  for (const threadId in oldIndex) {
    if (!index[threadId]) {
      index[threadId] = oldIndex[threadId]
    }
  }

  const sortedTranscriptEntries = Object.values(index).sort((a, b) => {
    // Sort by lastActivity timestamp (most recent first)
    // If no timestamp available, put at the bottom
    if (!a.lastActivity) return 1
    if (!b.lastActivity) return -1
    return (
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    )
  })

  const indexHtml = generateGuildIndex(guild.name, sortedTranscriptEntries)
  const indexPath = path.join(TRANSCRIPT_DIR, 'index.html')
  fs.writeFileSync(indexPath, indexHtml)
  // Copy the stylesheet to the output directory.
  const stylesPath = path.join(TRANSCRIPT_DIR, 'styles.css')
  fs.copyFileSync(path.join(__dirname, 'styles.css'), stylesPath)
  console.log(`Generated index.html for guild ${guild.name}.`)

  // Emit the index.json file.
  const indexJsonPath = path.join(TRANSCRIPT_DIR, 'index.json')
  fs.writeFileSync(indexJsonPath, JSON.stringify(index, null, 2))
  console.log(`Generated index.json for guild ${guild.name}.`)
}

client.once(Events.ClientReady, async (readyClient: Client) => {
  console.log(`Logged in as ${readyClient.user?.tag}`)

  try {
    // Process specified guilds.
    console.log('Generating transcripts for channels...')
    console.log('Looking for guild:', GUILD_ID)

    const guild = await client.guilds.fetch(GUILD_ID)
    console.log(`Found guild: ${guild.name}`)

    await processGuild(guild)
  } catch (error) {
    console.error(
      'An error occurred:',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    // Disconnect the bot after processing.
    client.destroy()
    console.log('Bot disconnected.')
  }
})

// Login to Discord with the bot token.
client.login(DISCORD_TOKEN)

// Export a run function.
export async function run(): Promise<void> {
  await client.login(DISCORD_TOKEN)
}
