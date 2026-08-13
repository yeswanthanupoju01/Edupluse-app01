# EduPulse AI

An early-warning dashboard for tracking student risk, with two separate logins:

- **Faculty** — sees the full dashboard, student directory, and analytics. Can evaluate a student's risk from their attendance, marks, and assignment completion, and optionally set up a portal login for them.
- **Student** — logs into a simplified portal showing only their own attendance, marks, assignments, and risk status with a recommendation.

## Tech stack

- **Backend:** Node.js, Express, `node:sqlite` (built-in, no native compile step), `express-session`, `bcryptjs`
- **Frontend:** Plain HTML/CSS/JS (no framework)

## Run it locally

```bash
npm install
npm start
```

Open `http://localhost:3001`. A default faculty account is created on first run:

```
email:    admin@edupulse.local
password: admin123
```

Change this from Settings once you're in.

## Risk engine

```
score = attendance × 0.3 + marks × 0.4 + assignments × 0.3
≥ 75   → Low Risk
50–74  → Moderate Risk
< 50   → High Risk
```

## Known gaps

- Analytics page uses placeholder numbers in some views rather than fully computed ones.
- Risk thresholds are shown in Settings but not yet editable.
- No self-service password reset flow for students.
