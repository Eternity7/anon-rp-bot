const Database = require('better-sqlite3');
const db = new Database('submissions.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pseudonym TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS rp_posts (
    submission_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    review_channel_id TEXT,
    rp_channel_id TEXT,
    mod_review_enabled INTEGER DEFAULT 1,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS banned_users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT,
    banned_by TEXT,
    banned_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (guild_id, user_id)
  );
`);

module.exports = {
  // ── Submissions ────────────────────────────────────────────────
  saveSubmission(id, guildId, userId, pseudonym, title, content) {
    db.prepare(`
      INSERT INTO submissions (id, guild_id, user_id, pseudonym, title, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, guildId, userId, pseudonym, title, content);
  },

  getSubmission(id) {
    return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  },

  deleteSubmission(id) {
    const submission = db.prepare('SELECT user_id, guild_id FROM submissions WHERE id = ?').get(id);
    if (submission) {
      db.prepare('INSERT OR REPLACE INTO rp_posts (submission_id, guild_id, user_id) VALUES (?, ?, ?)').run(id, submission.guild_id, submission.user_id);
    }
    db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
  },

  getSubmitterUserId(submissionId) {
    const fromSubmissions = db.prepare('SELECT user_id FROM submissions WHERE id = ?').get(submissionId);
    if (fromSubmissions) return fromSubmissions.user_id;
    const fromPosts = db.prepare('SELECT user_id FROM rp_posts WHERE submission_id = ?').get(submissionId);
    return fromPosts ? fromPosts.user_id : null;
  },

  // ── Guild Settings ─────────────────────────────────────────────
  getGuildSettings(guildId) {
    return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  },

  setGuildSettings(guildId, reviewChannelId, rpChannelId) {
    db.prepare(`
      INSERT INTO guild_settings (guild_id, review_channel_id, rp_channel_id)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        review_channel_id = excluded.review_channel_id,
        rp_channel_id = excluded.rp_channel_id,
        updated_at = strftime('%s', 'now')
    `).run(guildId, reviewChannelId, rpChannelId);
  },

  toggleModReview(guildId, enabled) {
    db.prepare(`
      INSERT INTO guild_settings (guild_id, mod_review_enabled)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        mod_review_enabled = excluded.mod_review_enabled,
        updated_at = strftime('%s', 'now')
    `).run(guildId, enabled ? 1 : 0);
  },

  // ── Banned Users ───────────────────────────────────────────────
  banUser(guildId, userId, reason, bannedBy) {
    db.prepare(`
      INSERT OR REPLACE INTO banned_users (guild_id, user_id, reason, banned_by)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, reason, bannedBy);
  },

  unbanUser(guildId, userId) {
    db.prepare('DELETE FROM banned_users WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  },

  isUserBanned(guildId, userId) {
    return !!db.prepare('SELECT 1 FROM banned_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  },

  getBannedUsers(guildId) {
    return db.prepare('SELECT * FROM banned_users WHERE guild_id = ?').all(guildId);
  }
};
