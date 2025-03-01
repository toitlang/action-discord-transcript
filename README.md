# Discord Transcript Action

This bot connects to Discord and generates HTML transcripts for the #help
channel.

## Features

- Generates HTML transcripts using the `discord-html-transcripts` package
- Saves transcripts to a specified output directory

### Inputs

- `discord-credentials`: The credentials to authenticate against the Discord API.
   These are used as '.env' file, and have the same structure as the tutorial bot.
- `guild-id`: The guild ID. You can find this by right-clicking on the server icon
   and selecting "Copy ID".
- `output-directory`: The directory where the transcripts will be saved.

## Example

```yaml
       - name: "Run the transcript action"
         uses: toitlang/action-discord-transcript@v1.0.0
         with:
           discord-credentials: ${{ secrets.DISCORD_CREDENTIALS }}
           guild-id: {{ env.GUILD_ID }}
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

## Output

The output directory contains an html file for each thread in the #help forum.

In addition, the output directory contains a `index.html` file that links to all
the transcripts.

Finally, it also produces an `index.json` file that contains the metadata for
each transcript. This can be used to generate a more complex index page.

## Run locally

You can also just run the transcript generation locally.

Install the dependencies and build the project:

```bash
npm install
npm run build
```

Save the Discord credentials to a `.env` file. These are in the same format as
the tutorial bot.

```bash
APP_ID=your-discord-app-id
PUBLIC_KEY=your-discord-public-key
DISCORD_TOKEN=your-discord-token
```

Run the script.

```bash
# Either run the script directly
npm run start:dev -- -o out-folder your-guild-id
# Or run the script with the compiled code
npm run start -- -o out-folder your-guild-id
```
