const Database = require('better-sqlite3');
const db = new Database('submissions.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    pseudonym TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

module.exports = {
  saveSubmission(id, userId, pseudonym, title, content) {
    db.prepare(`
      INSERT INTO submissions (id, user_id, pseudonym, title, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, pseudonym, title, content);
  },

  getSubmission(id) {
    return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  },

  updateStatus(id, status) {
    db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, id);
  },

  deleteSubmission(id) {
    db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
  }
};
