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
    password TEXT NOT NULL
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
    const { username, password } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
      const info = stmt.run(username, password);
      res.json({ success: true, user: { id: info.lastInsertRowid, username } });
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT") {
        res.status(400).json({ error: "Username already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password) as any;
    if (user) {
      res.json({ success: true, user: { id: user.id, username: user.username } });
    } else {
      res.status(401).json({ error: "Invalid username or password" });
    }
  });

  // Save Score
  app.post("/api/scores", (req, res) => {
    const { user_id, username, score, maxCombo, song, difficulty } = req.body;
    const date = new Date().toLocaleDateString();
    try {
      const stmt = db.prepare(`
        INSERT INTO scores (user_id, username, score, max_combo, song, difficulty, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(user_id || null, username || "Guest", score, maxCombo, song, difficulty, date);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save score" });
    }
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
