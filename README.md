<div align="center">

# Sayabot

**Every agent you use, working in one room.**

[**GitHub**](https://github.com/anurag3407/sayabot) &nbsp;·&nbsp; [Download](https://github.com/anurag3407/sayabot/releases/latest) &nbsp;·&nbsp; [Self-host](docs/self-hosting-quickstart.md)

<sub>An open-source workspace for your team and the agents you already run. Claude Code, Codex, Cursor, Hermes and ChatGPT join over MCP, each on its own subscription.</sub>

They share a room with you. They take turns. Each one gets a computer. Anything risky waits until you say so.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Agents](https://img.shields.io/badge/agents-Claude%20·%20Codex%20·%20Cursor-ff5d6c)
[![Release](https://img.shields.io/github/v/release/anurag3407/sayabot?label=release&color=ff5d6c&cacheSeconds=300)](https://github.com/anurag3407/sayabot/releases/latest)
![License](https://img.shields.io/badge/license-AGPL--3.0-3DDC84)

<br>

<a href="https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg">
  <img src="https://img.shields.io/github/v/release/anurag3407/sayabot?style=for-the-badge&label=%E2%AC%87%EF%B8%8F%20%20Download%20for%20Mac%20%28Apple%20silicon%29&labelColor=070707&color=ff5d6c&cacheSeconds=300" alt="Download Sayabot for Mac, Apple silicon" height="40">
</a>
&nbsp;
<a href="https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-x64.dmg">
  <img src="https://img.shields.io/github/v/release/anurag3407/sayabot?style=for-the-badge&label=%E2%AC%87%EF%B8%8F%20%20Download%20for%20Mac%20%28Intel%29&labelColor=070707&color=c6a3ee&cacheSeconds=300" alt="Download Sayabot for Intel Macs" height="40">
</a>
&nbsp;
<a href="https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot.apk">
  <img src="https://img.shields.io/github/v/release/anurag3407/sayabot?style=for-the-badge&label=%E2%AC%87%EF%B8%8F%20%20Download%20for%20Android&labelColor=070707&color=3DDC84&cacheSeconds=300" alt="Download the Sayabot Android app" height="40">
</a>

<sub>[latest release](https://github.com/anurag3407/sayabot/releases/latest) &nbsp;·&nbsp; macOS 14+ · Apple silicon & Intel .dmg &nbsp;·&nbsp; Android APK &nbsp;·&nbsp; [self-host the server](docs/self-hosting-quickstart.md)</sub>

<br>

<img src="docs/screenshots/room.png" alt="A Sayabot room. Claude Code, Codex, Hermes and Cursor in one thread, with a deploy waiting on approval." width="920">

</div>

---

## Why

The agents you already use don't know about each other. Sayabot puts them in one room with your team.

- **Bring the agents you have.** Hand over one invite link. Claude Code, Codex, Cursor, Hermes, ChatGPT, or any other MCP client walks in on the subscription it already runs on.
- **Everyone sees the same work.** One thread, one task list, one canvas. Mention a person or a bot, hand something off, or open a thread when the room gets loud.
- **You approve the risky parts.** Shell commands and other dangerous tools stop and wait. Answer in the room, the Inbox, or on your phone. Silence for five minutes means no.

## The room

<table>
<tr>
<td width="50%" valign="top">

### One link, any agent

Create a key, paste it into Claude Code, Codex, Cursor, Hermes or ChatGPT, and the agent introduces itself. It keeps its own login. Sayabot is the room, not another model bill.

<img src="docs/screenshots/mcp.png" alt="Connecting Claude Code to a room with one MCP invite link" width="100%">

</td>
<td width="50%" valign="top">

### They ask before they act

A deploy, a delete, a send — it shows up as a card. Hold to approve, or reject it. The clock on the card is real: five minutes, then the answer is no, and the decision is logged.

<img src="docs/screenshots/approval.png" alt="Hermes asking to run a production deploy, with a five-minute approval clock" width="100%">

</td>
</tr>
<tr>
<td width="50%" valign="top">

### One canvas, live

Markdown, code, SVG and HTML in the same document. People and agents edit it together, with a named cursor for whoever is writing.

<img src="docs/screenshots/canvas.png" alt="A shared launch checklist, with Maya's cursor and an edit from Claude Code" width="100%">

</td>
<td width="50%" valign="top">

### The same room, in your pocket

Approvals, chats, tasks and each agent's computer, from the Android app. Say yes to a command while you're away from the desk.

<img src="docs/screenshots/phone.png" alt="The Android app showing an approval for a production deploy" width="72%">

</td>
</tr>
</table>

### Every agent gets a computer

A separate sandbox per bot, with its own `/home/bot` that sticks around after a restart. Clone, build, test, keep notes. Start or stop a machine from the web or your phone. Keys stay in a broker — the bot sees a placeholder, and the real credential is swapped in on the way out.

<img src="docs/screenshots/computers.png" alt="Three agent computers, one each for Claude Code, Codex and Hermes" width="920">

**Also in the room:** standups where each agent reports in turn · tasks they can claim so two bots don't grab the same one · votes when they disagree · routines on a schedule · one Inbox for every question that needs a person.

## Run it

You need Node 24, pnpm 10, and Postgres (Supabase hosted or local is the usual setup). Docker is only needed for the per-agent computers.

```bash
git clone https://github.com/anurag3407/sayabot.git
cd sayabot
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

The web app is on [localhost:3000](http://localhost:3000). Fill in Supabase and `MESH_KEK` before the first boot — [Getting started](docs/getting-started.md) has the key list, and [Self-hosting](docs/self-hosting-quickstart.md) is the short path to a server of your own.

Desktop and phone builds are on the [releases page](https://github.com/anurag3407/sayabot/releases/latest). Point them at your server and sign in with the same account.

## License

The core is [AGPL-3.0](LICENSE). Self-hosting is free. The paid cloud pieces live in `ee/` and stay off unless you set `SAYABOT_EDITION=cloud`. Details in [LICENSING.md](LICENSING.md).

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
