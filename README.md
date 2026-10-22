# Telegram Apartment Search Bot

Node.js + Telegraf + Express. Apartment posts stay in your Telegram listing channel. The bot maintains a local JSON index so it can find posts by apartment code without a database server.

## Features

- Persian welcome message and customer group button
- Customers send a numeric apartment code (for example `424`)
- Bot copies indexed channel messages, including photos and captions, into the customer's private chat
- New channel posts are indexed automatically
- Edited channel posts are re-indexed
- Optional contact button
- `/help`, `/find 424`, and `/stats`
- Express `/health` endpoint for hosting checks
- Persistent index at `data/index.json`

## Requirements

- Node.js 20+
- A bot token from `@BotFather`
- A Telegram listing channel
- A Telegram customer group or invitation link

## Setup

1. Create a folder from this project and install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the values.

   ```bash
   cp .env.example .env
   ```

   On Windows, copy the file manually if `cp` is unavailable.

3. Add your bot to the listing channel as an administrator. It must receive channel posts. For a private channel, set `LISTING_CHANNEL_ID` to its numeric ID, usually starting with `-100`.

4. Start the bot:

   ```bash
   npm start
   ```

5. Open your bot in Telegram and send `/start`.

## Listing format

Every apartment post must include a code in the text or photo caption, such as:

```text
کد: 424
موقعیت: آبادگران
تعداد خواب: 1
ظرفیت: 2 نفر
امکانات: تراس، ویو شهر، تلویزیون هوشمند
رزرو و هماهنگی: @your_support
```

You can also use `Code: 424` or `Apartment #424`.

If an apartment has several separate posts, include the same code in each post. For a Telegram media album, put the code in the album caption; the bot associates subsequent album items with that code when Telegram sends them as a media group.

## Important limitations

- Telegram's standard Bot API cannot fetch arbitrary historical channel messages. The bot indexes posts it receives after it is running. Existing posts must be republished or imported by a separate method.
- Keep `data/index.json` persistent on your hosting provider. If the host uses an ephemeral filesystem, the index may disappear on redeploy/restart.
- Use one bot process. Running multiple polling instances with the same token can cause Telegram update conflicts.
- The bot needs to be started and kept online to index new posts.
- Channel posts deleted from Telegram are not automatically removed from this index.
- The index is a lightweight JSON file, not a full database. For a large catalogue or multiple bot instances, use SQLite or PostgreSQL.
- Don't commit `.env` or share your bot token. If a token is exposed, revoke it through BotFather and create a new one.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | BotFather token |
| `LISTING_CHANNEL_ID` | Yes | Public channel username (`@name`) or numeric channel ID |
| `GROUP_URL` | Yes | Customer group URL |
| `COMPANY_NAME` | No | Company name shown in `/start` |
| `COMPANY_INFO` | No | Welcome text |
| `CONTACT_URL` | No | Contact or reservation link |
| `PORT` | No | Express port, default `3000` |
| `ADMIN_IDS` | No | Comma-separated numeric Telegram user IDs allowed for admin commands |

## Admin workflow

1. Publish a listing to the configured channel.
2. Put its code in the caption or text.
3. Keep the code consistent across all posts for that apartment.
4. Send the code to the bot to test the result.
5. Use `/stats` to check indexed codes.

This first version deliberately does not implement automatic historical channel import, booking/payment processing, or a web dashboard.
