# CLIPCLIPER MCP server

[![smithery badge](https://smithery.ai/badge/clipcliper/clipcliper)](https://smithery.ai/servers/clipcliper/clipcliper)

Give your agent a public video link and get back a **timestamped transcript**, **chapters** and
**clip suggestions**. Works with YouTube (videos, shorts, live replays), Twitch VODs, Kick VODs
and TikTok, including the platforms that block datacenter IPs.

The server is hosted: nothing to download or run on GPUs. The video is fetched, transcribed
with Whisper large-v3 and deleted; only the transcript stays, for 24 hours.

## Tools

| Tool | What it does |
|---|---|
| `get_transcript` | Full transcript with timestamps. Formats: `timestamped` (default), `text`, `srt`, `segments` (JSON). |
| `get_chapters` | Topic chapters: `start`, `end`, `title`, one-line `summary`. |
| `suggest_clips` | The most shareable moments for short-form clips: `start`, `end`, hook-style `title`, `reason`. Accepts an editorial `instruction`. |

All three take a `url`. Processing is asynchronous: a call waits up to `wait_seconds`
(default 90) and, if the video is still downloading or transcribing, returns
`status: "processing"`. Call the same tool again with the same url; the job keeps running on
the server and nothing is charged twice. Results are cached for 24 hours per url.

## Connect

Listed on [Smithery](https://smithery.ai/servers/clipcliper/clipcliper) (one-click setup for Claude, Cursor and other clients) and submitted to the Glama registry.

**Remote (recommended)**, Streamable HTTP:

```
https://clipcliper.com/mcp
Authorization: Bearer <your license key>
```

Claude Code:

```bash
claude mcp add --transport http clipcliper https://clipcliper.com/mcp --header "Authorization: Bearer YOUR_KEY"
```

Claude Desktop, Cursor and other clients that take a JSON config (remote):

```json
{
  "mcpServers": {
    "clipcliper": {
      "type": "http",
      "url": "https://clipcliper.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

**Local bridge (stdio)** for clients that cannot call a URL directly:

```json
{
  "mcpServers": {
    "clipcliper": {
      "command": "npx",
      "args": ["-y", "clipcliper-mcp"],
      "env": { "CLIPCLIPER_LICENSE_KEY": "YOUR_KEY" }
    }
  }
}
```

The bridge is this repository: a ~100-line process that speaks MCP over stdio and forwards
every call to the hosted endpoint with your key. Until the npm package is published you can run
it straight from GitHub: `npx -y github:Inmoprice/clipcliper-mcp`.

## Keys and pricing

- **Without a key**: each IP can process 3 videos per day of up to 15 minutes. Good for trying it.
- **With a key**: minute packs at [clipcliper.com/mcp](https://clipcliper.com/mcp), one-time, minutes never expire:

| Pack | Price | Minutes | Per minute |
|---|---|---|---|
| Starter | USD 9 | 600 | USD 0.015 |
| Pro | USD 29 | 3,000 | USD 0.0097 |
| Scale | USD 79 | 12,000 | USD 0.0066 |

Every video costs one pack minute per started minute of video; chapters and clip suggestions on
a transcribed video are free. The license key is emailed to you right after checkout. Send it
as `Authorization: Bearer <key>` (or `X-License-Key`); it never goes in tool arguments or URLs.
Hour packs of the CLIPCLIPER desktop app also work here (one pack hour per started hour).

## REST

Prefer plain HTTP? The same pipeline is available at
`POST https://clipcliper.com/api/link/transcribe`, `/api/link/chapters` and `/api/link/suggest`
with a JSON body `{"url": "..."}` and the same header. `202` while processing, `200` when done.

## Privacy

- The video file is deleted as soon as the transcript exists; the transcript expires after 24 h.
- No accounts, no cookies. Usage is counted per key (hours) or per IP hash (free tier).
- Questions: support@clipcliper.com

## License

MIT for the code in this repository (the bridge). The hosted service is subject to
[clipcliper.com](https://clipcliper.com)'s terms.
