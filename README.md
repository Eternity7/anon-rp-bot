# Anonymous RP Bot

A Discord bot for submitting, reviewing, and publishing anonymous RP posts.

## Features
- Players submit posts via `/rp-1x1` slash command
- A modal form collects pseudonym, title, and content
- Submission is sent to a mod review channel with Approve/Deny buttons
- If approved: post is published in the RP channel as the pseudonym
- A thread is automatically created on the post for RP replies
- If denied: mod enters a reason, submitter is DM'd with the reason

## Setup

### 1. Create a Discord Bot
1. Go to https://discord.com/developers/applications
2. Click "New Application" → name it
3. Go to "Bot" tab → click "Add Bot"
4. Copy the **Token**
5. Under "Privileged Gateway Intents" enable: `Server Members Intent`, `Message Content Intent`
6. Go to "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Create Public Threads`, `Embed Links`, `Read Message History`
7. Copy the generated URL and invite the bot to your server

### 2. Get Your IDs
Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
- **CLIENT_ID**: Right-click your bot in the member list → Copy ID
- **GUILD_ID**: Right-click your server name → Copy Server ID
- **MOD_REVIEW_CHANNEL_ID**: Right-click your mod review channel → Copy Channel ID
- **RP_CHANNEL_ID**: Right-click your RP channel → Copy Channel ID
