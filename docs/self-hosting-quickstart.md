# Self-host Sayabot in 10 minutes

Run Sayabot on your own server, free under the [AGPL](../LICENSE). Your data stays on that
server: chats, agents, files and sign-in. Nothing goes through Sayabot Cloud. The Mac and phone
apps connect to your server.

## What you need

- A Linux server: Ubuntu 22.04/24.04 or Debian 12, **2 vCPU / 4 GB RAM**, 40 GB disk.
- A domain (or subdomain) pointing at it: an `A` record like `sayabot.yourcompany.com → your server's IP`.
- About 10 minutes, most of it the first build.

## 1. Prepare the server (once)

From your laptop:

```bash
scp deploy/scripts/setup-vps.sh root@YOUR_IP:/root/
ssh root@YOUR_IP 'bash /root/setup-vps.sh --user deploy --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"'
```

This installs Docker, a firewall and swap, and turns off password SSH logins. Before you close
the root session, check that `ssh deploy@YOUR_IP` works in a second terminal.

## 2. Install

```bash
ssh deploy@YOUR_IP
git clone https://github.com/anurag3407/sayabot.git ~/sayabot && cd ~/sayabot
./deploy/install.sh
```

The installer asks four things:

| Question               | What to answer                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Domain                 | `sayabot.yourcompany.com`                                                                         |
| Name shown in the apps | e.g. `Acme's Sayabot`                                                                             |
| HTTPS                  | **a)** free Let's Encrypt certificate (needs the DNS record), or **b)** a Cloudflare Tunnel token |
| Database and sign-in   | **a) Everything on this server** (recommended), or **b)** your own supabase.com project           |

It generates every secret, writes `deploy/.env.production` (readable only by you), gets the
certificate and starts Sayabot. When it's done, open `https://sayabot.yourcompany.com` and
create your account. The first workspace is yours.

Re-run `./deploy/install.sh` any time to change an answer. It keeps your existing secrets.

## 3. Connect the apps

- **Mac**: install Sayabot for Mac, then open `https://sayabot.yourcompany.com/download` and click
  **Open in Sayabot for Mac**. Or, on the app's first screen, choose **My own server** and type
  your address.
- **Phone**: on the sign-in screen, tap **Server** and enter your address. Or scan the
  pairing code from **Settings → Phones** in the web app; the phone switches to your server
  on its own.

The apps check the address first and show your server's name, so a typo can't send anyone
to the wrong place.

## Day to day

```bash
git pull && ./deploy/deploy.sh     # update: get the latest code, build, migrate, roll out
./deploy/deploy.sh backup          # database backup to deploy/backups (bundled database)
./deploy/deploy.sh rollback        # back to the previous release
./deploy/deploy.sh status | logs   # what's running, and its logs
```

Updates are health-checked: if the new version doesn't come up, the previous one is restored
automatically.

**Back up two things:** `deploy/.env.production` (above all `SAYABOT_KEK`, which encrypts saved
API keys) and your database backups. Keep copies off the server.

## Choices explained

**Everything on this server** runs Supabase's open-source stack next to Sayabot: Postgres
(with pgvector), sign-in, live updates and file storage, behind the same domain. Nothing
depends on any outside service. Email sign-up works right away. To send real emails
(password resets, invites) or turn on "Sign in with Google/GitHub", add the `SMTP_*` /
`SUPABASE_GOOGLE_*` settings shown in [`.env.production.example`](../deploy/.env.production.example)
and run `./deploy/deploy.sh reload`.

**Your own supabase.com project** keeps the database on Supabase's managed service. It's handy if
you already use Supabase. On the free plan, Supabase pauses projects after a week without
activity, so use a paid project for an always-on server. In Supabase → Authentication, turn on
"Allow anonymous sign-ins" for the Mac app's no-account start.

**AI models**: each workspace connects its own under **AI accounts** (API keys, or Claude Code /
Codex signed in on someone's Mac). To give everyone on the server a shared model, set the
`SAYA_AI_*` settings in `.env.production`.

**Limits**: a self-hosted server has no plans, limits or billing. Those exist only on Sayabot Cloud.

## Troubleshooting

| Problem                                  | Fix                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No TLS certificate"                     | The domain must point at the server before step 2. Check with `dig +short sayabot.yourcompany.com`, then re-run the installer.                          |
| The Mac app says "isn't running Sayabot" | Open `https://your-domain/api/instance` in a browser. It should show `"sayabot": true`. If it doesn't, the server needs updating: `./deploy/deploy.sh`. |
| Sign-in works but live updates don't     | `./deploy/deploy.sh logs supabase-realtime`. Firewalls or proxies must allow WebSockets on `/realtime/v1/`.                                             |
| Out of memory during the first build     | The web build needs about 3 GB. The setup script adds 4 GB of swap; on a smaller server, resize to 4 GB RAM for the first build.                        |

More detail: [deploy/README.md](../deploy/README.md) and [self-hosting.md](self-hosting.md).
