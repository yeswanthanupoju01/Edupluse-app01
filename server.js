// EduPulse AI — backend server
// Express + SQLite (Node's built-in node:sqlite — no native compile step) +
// session-based auth with two roles: 'faculty' (sees everyone) and
// 'student' (sees only their own record).

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me-in-production';

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    attendance REAL NOT NULL,
    marks REAL NOT NULL,
    assignments REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('faculty','student')),
    name TEXT NOT NULL,
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
`);

const uid = () => crypto.randomUUID();

// Seed a default faculty account on first run so there's always a way in.
const facultyCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'faculty'`).get().c;
if (facultyCount === 0) {
  const id = uid();
  const passwordHash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, name, created_at) VALUES (?, ?, ?, 'faculty', ?, ?)`)
    .run(id, 'admin@edupulse.local', passwordHash, 'Dr. Sarah Jenkins', new Date().toISOString());
  console.log('No faculty account existed, so one was created:');
  console.log('  email:    admin@edupulse.local');
  console.log('  password: admin123');
  console.log('  -> log in and change this password right away (Settings > Change Password).');
}

const app = express();
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }, // 8 hour session
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth middleware ----

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).json({ error: 'Not authorized for this' });
    }
    next();
  };
}

// ---- Risk engine ----
// Weighted score across attendance, marks, and assignment completion.
function assessRisk({ attendance, marks, assignments }) {
  const score = attendance * 0.3 + marks * 0.4 + assignments * 0.3;

  let level, label;
  if (score >= 75) { level = 'safe'; label = 'Low Risk (Safe)'; }
  else if (score >= 50) { level = 'warning'; label = 'Moderate Risk'; }
  else { level = 'danger'; label = 'High Risk (At Risk)'; }

  let recommendation;
  if (level === 'safe') {
    recommendation = 'Encourage continued high performance. Suggest advanced elective modules or peer mentoring opportunities to maintain engagement.';
  } else if (level === 'warning') {
    recommendation = 'Schedule a check-in regarding assignment completion rates. Recommend targeted tutoring sessions for weaker subject chapters and monitor upcoming attendance closely.';
  } else {
    recommendation = 'Immediate intervention required. Trigger an automated alert to academic counseling, set up a mandatory faculty meeting, and establish a recovery plan for missed assessments.';
  }

  return { score: Math.round(score), level, label, recommendation };
}

// ---- Auth routes ----

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  req.session.user = { id: user.id, role: user.role, name: user.name, student_id: user.student_id };
  res.json({ role: user.role, name: user.name });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

app.patch('/api/auth/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 10), user.id);
  res.status(204).end();
});

// ---- Faculty routes ----

app.get('/api/stats', requireRole('faculty'), (req, res) => {
  const students = db.prepare(`SELECT attendance, marks, assignments FROM students`).all();
  const total = students.length;
  const atRisk = students.filter(s => assessRisk(s).level !== 'safe').length;
  const avgAttendance = total
    ? Math.round((students.reduce((a, s) => a + s.attendance, 0) / total) * 10) / 10
    : 0;
  res.json({ total, atRisk, avgAttendance });
});

app.get('/api/students', requireRole('faculty'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM students ORDER BY created_at DESC`).all();
  const loginEmails = new Set(db.prepare(`SELECT student_id FROM users WHERE role = 'student'`).all().map(r => r.student_id));
  const withRisk = rows.map(s => ({ ...s, risk: assessRisk(s), hasPortalAccess: loginEmails.has(s.id) }));
  res.json(withRisk);
});

// Creates a student record. Optionally also creates a portal login for them
// if email + password are provided.
app.post('/api/students', requireRole('faculty'), (req, res) => {
  const { name, attendance, marks, assignments, email, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Student name is required' });
  const att = Number(attendance), mk = Number(marks), asg = Number(assignments);
  if ([att, mk, asg].some(n => Number.isNaN(n) || n < 0 || n > 100)) {
    return res.status(400).json({ error: 'Attendance, marks, and assignments must be numbers between 0 and 100' });
  }

  if (email && !password) return res.status(400).json({ error: 'Set a password to create portal access' });
  if (password && !email) return res.status(400).json({ error: 'Set an email to create portal access' });
  if (email) {
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.trim().toLowerCase());
    if (existing) return res.status(400).json({ error: 'That email is already in use' });
  }

  const id = uid();
  const created_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO students (id, name, attendance, marks, assignments, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), att, mk, asg, created_at);

  if (email && password) {
    db.prepare(`INSERT INTO users (id, email, password_hash, role, name, student_id, created_at) VALUES (?, ?, ?, 'student', ?, ?, ?)`)
      .run(uid(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), name.trim(), id, created_at);
  }

  const student = { id, name: name.trim(), attendance: att, marks: mk, assignments: asg, created_at };
  res.status(201).json({ ...student, risk: assessRisk(student), hasPortalAccess: !!(email && password) });
});

app.delete('/api/students/:id', requireRole('faculty'), (req, res) => {
  db.prepare(`DELETE FROM students WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---- Student routes ----

app.get('/api/me/student', requireRole('student'), (req, res) => {
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(req.session.user.student_id);
  if (!student) return res.status(404).json({ error: 'No student record linked to this account' });
  res.json({ ...student, risk: assessRisk(student) });
});

// ---- Static page fallback ----

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`EduPulse AI running at http://localhost:${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
});
