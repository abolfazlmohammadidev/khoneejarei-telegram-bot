require("dotenv").config();
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { Telegraf, Markup } = require("telegraf");

const required = ["BOT_TOKEN", "LISTING_CHANNEL_ID", "GROUP_URL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_CONFIG = process.env.LISTING_CHANNEL_ID.trim();
const GROUP_URL = process.env.GROUP_URL.trim();
const COMPANY_NAME = process.env.COMPANY_NAME || "اقامتگاه و اجاره آپارتمان";
const COMPANY_INFO =
  process.env.COMPANY_INFO ||
  "برای دریافت تصاویر و مشخصات آپارتمان، کد واحد را ارسال کنید.";
const CONTACT_URL = process.env.CONTACT_URL || "";
const PORT = Number(process.env.PORT || 3000);
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyIndex() {
  return { version: 1, posts: {}, mediaGroups: {} };
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return emptyIndex();
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    return {
      version: 1,
      posts: parsed.posts && typeof parsed.posts === "object" ? parsed.posts : {},
      mediaGroups:
        parsed.mediaGroups && typeof parsed.mediaGroups === "object"
          ? parsed.mediaGroups
          : {},
    };
  } catch (error) {
    console.error("Could not read data/index.json:", error.message);
    console.error("Starting with an empty index. Keep a backup of the data folder.");
    return emptyIndex();
  }
}

let index = loadIndex();
let saveQueue = Promise.resolve();

function saveIndex() {
  // Serialize writes so simultaneous channel updates don't corrupt the JSON file.
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${INDEX_FILE}.tmp`;
    await fs.promises.writeFile(tempFile, JSON.stringify(index, null, 2), "utf8");
    await fs.promises.rename(tempFile, INDEX_FILE);
  });
  return saveQueue;
}

function channelMatches(chat) {
  if (!chat) return false;

  if (CHANNEL_CONFIG.startsWith("@")) {
    return (chat.username || "").toLowerCase() ===
      CHANNEL_CONFIG.slice(1).toLowerCase();
  }

  // Numeric ID is recommended for private channels.
  return String(chat.id) === CHANNEL_CONFIG;
}

function getMessageText(message) {
  return message?.text || message?.caption || "";
}

function extractApartmentCode(message) {
  const content = getMessageText(message);
  // Accepted examples: "Code: 424", "کد: 424", "Apartment #424"
  const patterns = [
    /(?:apartment\s*)?(?:code|کد)\s*[:：#-]?\s*(\d{1,10})/i,
    /apartment\s*#\s*(\d{1,10})/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function addPost(code, chatId, messageId, mediaGroupId = null) {
  if (!code || !chatId || !messageId) return false;
  const key = String(code);
  const messageKey = `${chatId}:${messageId}`;

  // One message can only belong to one code in this index.
  for (const [oldCode, ids] of Object.entries(index.posts)) {
    if (ids.some((entry) => entry.key === messageKey) && oldCode !== key) {
      index.posts[oldCode] = ids.filter((entry) => entry.key !== messageKey);
      if (index.posts[oldCode].length === 0) delete index.posts[oldCode];
    }
  }

  if (!index.posts[key]) index.posts[key] = [];
  const existing = index.posts[key].find((entry) => entry.key === messageKey);
  const entry = {
    key: messageKey,
    chatId,
    messageId,
    mediaGroupId: mediaGroupId || null,
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, entry);
  else index.posts[key].push(entry);

  index.posts[key].sort((a, b) => a.messageId - b.messageId);

  if (mediaGroupId) {
    index.mediaGroups[String(mediaGroupId)] = {
      code: key,
      chatId,
      updatedAt: Date.now(),
    };
  }
  return true;
}

function removePost(chatId, messageId) {
  const messageKey = `${chatId}:${messageId}`;
  for (const code of Object.keys(index.posts)) {
    index.posts[code] = index.posts[code].filter((entry) => entry.key !== messageKey);
    if (index.posts[code].length === 0) delete index.posts[code];
  }
}


async function indexChannelPost(message) {
  if (!message) return;

  console.log(
    `[CHANNEL POST] Received post from "${message.chat?.title || "unknown"}"`,
    `chatId=${message.chat?.id}`,
    `messageId=${message.message_id}`
  );

  if (!channelMatches(message.chat)) {
    console.log(
      `[CHANNEL POST] Ignored: channel does not match LISTING_CHANNEL_ID.`
    );
    return;
  }

  const content = getMessageText(message);
  const codeInPost = extractApartmentCode(message);

  console.log(`[CHANNEL POST] Text/caption: ${content || "(no text/caption)"}`);
  console.log(`[CHANNEL POST] Detected apartment code: ${codeInPost || "NONE"}`);

  const mediaGroupId = message.media_group_id
    ? String(message.media_group_id)
    : null;

  let code = codeInPost;

  if (!code && mediaGroupId && index.mediaGroups[mediaGroupId]) {
    code = index.mediaGroups[mediaGroupId].code;
  }

  if (!code) {
    console.log("[CHANNEL POST] No apartment code found; post not indexed.");
    return;
  }

  addPost(code, message.chat.id, message.message_id, mediaGroupId);
  await saveIndex();

  console.log(
    `[CHANNEL POST] SUCCESS: indexed code ${code}, message ${message.message_id}`
  );
}

function getWelcomeKeyboard() {
  const rows = [[Markup.button.url("عضویت در گروه تلگرام", GROUP_URL)]];
  if (CONTACT_URL) {
    rows.push([Markup.button.url("رزرو و هماهنگی", CONTACT_URL)]);
  }
  return Markup.inlineKeyboard(rows);
}

const bot = new Telegraf(TOKEN);

bot.start(async (ctx) => {
  const keyboard = getWelcomeKeyboard();
  const welcome =
    `سلام، به ${COMPANY_NAME} خوش آمدید! 🏡\n\n` +
    `${COMPANY_INFO}\n\n` +
    "🔎 برای جست‌وجو، کد آپارتمان را بفرستید؛ مثلاً: 424";
  await ctx.reply(welcome, keyboard);
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "برای مشاهده اطلاعات یک واحد، کد آن را ارسال کنید؛ مثلاً 424.\n" +
      "اگر کد را ندارید، با پشتیبانی تماس بگیرید."
  );
});

bot.command("stats", async (ctx) => {
  if (ADMIN_IDS.size && !ADMIN_IDS.has(String(ctx.from.id))) {
    return ctx.reply("این دستور فقط برای مدیران فعال است.");
  }
  const codes = Object.keys(index.posts);
  const messageCount = Object.values(index.posts).reduce(
    (sum, entries) => sum + entries.length,
    0
  );
  await ctx.reply(
    `آمار فهرست:\nتعداد کدهای ثبت‌شده: ${codes.length}\n` +
      `تعداد پیام‌های ایندکس‌شده: ${messageCount}`
  );
});

bot.command("find", async (ctx) => {
  const code = String(ctx.message.text.split(/\s+/)[1] || "").trim();
  if (!/^\d{1,10}$/.test(code)) {
    return ctx.reply("روش استفاده: /find 424");
  }
  await sendApartment(ctx, code);
});

async function sendApartment(ctx, code) {
  const posts = index.posts[String(code)] || [];
  if (!posts.length) {
    return ctx.reply(
      `واحدی با کد ${code} پیدا نشد. ❌\n` +
        "لطفاً کد را بررسی کنید یا با پشتیبانی تماس بگیرید."
    );
  }

  for (const post of posts) {
    try {
      await ctx.telegram.copyMessage(
        ctx.chat.id,
        post.chatId,
        post.messageId
      );
    } catch (error) {
      console.error(
        `Failed to copy ${post.chatId}/${post.messageId}:`,
        error.message
      );
      await ctx.reply(
        "بخشی از اطلاعات این واحد ارسال نشد. لطفاً با پشتیبانی تماس بگیرید."
      );
    }
  }

  const buttons = [];
  if (CONTACT_URL) {
    buttons.push([Markup.button.url("رزرو و هماهنگی", CONTACT_URL)]);
  }
  buttons.push([Markup.button.url("گروه تلگرام ما", GROUP_URL)]);
  await ctx.reply(
    `🏡 تصاویر و مشخصات واحد با کد ${code}:\n\nبرای رزرو یا دریافت اطلاعات بیشتر:`,
    Markup.inlineKeyboard(buttons)
  );
}

// Customer sends only the apartment code in a private chat.
bot.on("text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const code = ctx.message.text.trim();
  if (!/^\d{1,10}$/.test(code)) {
    return ctx.reply(
      "لطفاً فقط کد عددی آپارتمان را ارسال کنید؛ مثلاً 424.\n" +
        "برای راهنما، /help را بفرستید."
    );
  }
  await sendApartment(ctx, code);
});

// New channel posts are indexed automatically. Add the bot as a channel admin.
bot.on("channel_post", async (ctx) => {
  try {
    await indexChannelPost(ctx.channelPost);
  } catch (error) {
    console.error("Channel post indexing failed:", error);
  }
});

// Edited posts are re-indexed, including edits to captions.
bot.on("edited_channel_post", async (ctx) => {
  try {
    const message = ctx.editedChannelPost;
    if (!message || !channelMatches(message.chat)) return;

    removePost(message.chat.id, message.message_id);
    const code = extractApartmentCode(message);
    if (code) {
      addPost(
        code,
        message.chat.id,
        message.message_id,
        message.media_group_id ? String(message.media_group_id) : null
      );
    }
    await saveIndex();
  } catch (error) {
    console.error("Edited channel post indexing failed:", error);
  }
});

// Small HTTP server for hosting health checks.
const web = express();
web.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "telegram-apartment-search-bot",
    indexedApartmentCodes: Object.keys(index.posts).length,
  });
});
web.get("/health", (_req, res) => res.status(200).send("ok"));

const server = web.listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down...`);
  server.close();
  try {
    await bot.stop(signal);
  } catch (_) {}
  await saveQueue;
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

bot.launch()
  .then(() => console.log("Telegram apartment bot is running."))
  .catch((error) => {
    console.error("Bot failed to start:", error);
    process.exit(1);
  });
