# Action to generate Discord Transcripts

This bot connects to Discord and generates HTML transcripts for channels that are
selected in the given configuration file.

## Features

- Generates HTML transcripts using the `discord-html-transcripts` package
- Saves transcripts to a specified output directory

### Inputs

- `discord-credentials`: The credentials to authenticate against the Discord API.
   These are used as '.env' file, and have the same structure as the tutorial bot.
- `guild-config`: The configuration file that specifies the guilds and channels to generate transcripts for. See below.
- `output-directory`: The directory where the transcripts will be saved.

The `guild-config` file is a YAML file that specifies the guild and its channels
to generate transcripts for. The file has the following structure:

```yaml
name: "Guild Name"
channels:
   - "Channel Name"
   - "Another Channel Name"
```

## Example

```yaml
       - name: "Run the transcript action"
         uses: toitlang/action-discord-transcript@v1.0.0
         with:
           discord-credentials: ${{ secrets.DISCORD_CREDENTIALS }}
           guild-config: ${{ vars.GUILD_CONFIG }}
           output-directory: "transcripts"
```

Typically, this step is followed by a step that uploads the transcript to the
gh-pages branch of the repository.

```yaml
      - name: "Upload to gh-pages"
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: transcripts
          cname: "example.com"
```

## How it works

1. The bot connects to Discord using your provided token.
2. It finds all servers (guilds) the bot has access to.
3. For each server, it identifies channels that are specified in the configuration file.
4. It generates an HTML transcript for each channel/thread.
5. Transcripts are saved to the specified output directory under the guild name.
