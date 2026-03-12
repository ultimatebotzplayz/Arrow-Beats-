import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("game.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT,
    email TEXT UNIQUE,
    facebook_id TEXT UNIQUE,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    score INTEGER NOT NULL,
    max_combo INTEGER NOT NULL,
    song TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes ---

  // Register
  app.post("/api/register", (req, res) => {
    const { username, password, email } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO users (username, password, email, xp, level) VALUES (?, ?, ?, 0, 1)");
      const info = stmt.run(username, password, email || null);
      res.json({ success: true, user: { id: info.lastInsertRowid, username, email, xp: 0, level: 1 } });
    } catch (err: any) {
      console.error("Register Error:", err);
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT") {
        if (err.message.includes("users.username")) {
          res.status(400).json({ error: "Username already exists" });
        } else if (err.message.includes("users.email")) {
          res.status(400).json({ error: "Email already exists" });
        } else {
          res.status(400).json({ error: "User already exists" });
        }
      } else {
        res.status(500).json({ error: "System Error: Failed to register" });
      }
    }
  });

  // Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(username, username) as any;
    
    if (!user) {
      return res.status(404).json({ error: "Username not found" });
    }
    
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid password" });
    }

    res.json({ success: true, user: { id: user.id, username: user.username, xp: user.xp, level: user.level, email: user.email } });
  });

  // Social Login (Mock)
  app.post("/api/auth/social", (req, res) => {
    const { provider, providerId, username, email } = req.body;
    try {
      let user = db.prepare(`SELECT * FROM users WHERE ${provider}_id = ?`).get(providerId) as any;
      
      if (!user) {
        // Create new user for social login
        const stmt = db.prepare(`INSERT INTO users (username, ${provider}_id, email, xp, level) VALUES (?, ?, ?, 0, 1)`);
        const info = stmt.run(username, providerId, email || null);
        user = { id: info.lastInsertRowid, username, xp: 0, level: 1, email };
      }
      
      res.json({ success: true, user: { id: user.id, username: user.username, xp: user.xp, level: user.level, email: user.email } });
    } catch (err: any) {
      console.error("Social Login Error:", err);
      res.status(500).json({ error: "Social login failed" });
    }
  });

  // Save Score
  app.post("/api/scores", (req, res) => {
    const { user_id, username, score, maxCombo, song, difficulty } = req.body;
    const date = new Date().toLocaleDateString();
    try {
      db.transaction(() => {
        const stmt = db.prepare(`
          INSERT INTO scores (user_id, username, score, max_combo, song, difficulty, date)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(user_id || null, username || "Guest", score, maxCombo, song, difficulty, date);

        if (user_id) {
          const user = db.prepare("SELECT xp, level FROM users WHERE id = ?").get(user_id) as any;
          const newXp = user.xp + score;
          // Level formula: level = floor(sqrt(xp / 500)) + 1
          // Max level 1000
          let newLevel = Math.floor(Math.sqrt(newXp / 500)) + 1;
          if (newLevel > 1000) newLevel = 1000;
          
          db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").run(newXp, newLevel, user_id);
        }
      })();
      
      let updatedUser = null;
      if (user_id) {
        updatedUser = db.prepare("SELECT id, username, xp, level FROM users WHERE id = ?").get(user_id);
      }
      
      res.json({ success: true, user: updatedUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save score" });
    }
  });

  // Reset Password (Mock)
  app.post("/api/reset-password", (req, res) => {
    const { username, newPassword } = req.body;
    try {
      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(newPassword, user.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Bug Report
  app.post("/api/support", (req, res) => {
    const { username, message } = req.body;
    console.log(`Bug Report from ${username}: ${message}`);
    res.json({ success: true });
  });

  // Get Leaderboard
  app.get("/api/leaderboard", (req, res) => {
    const scores = db.prepare("SELECT * FROM scores ORDER BY score DESC LIMIT 10").all();
    res.json(scores);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
