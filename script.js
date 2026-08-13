// EduPulse AI — frontend logic
// Talks to the Express/SQLite backend over /api. Handles three page types:
// faculty pages (index/students/analytics/settings), the login page, and
// the student portal.

const API = '/api';

async function apiRequest(path, options) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function riskBadgeClass(level) {
  if (level === 'safe') return 'safe';
  if (level === 'warning') return 'warning';
  return 'danger';
}
function riskLabel(level) {
  if (level === 'safe') return 'Low Risk (Safe)';
  if (level === 'warning') return 'Moderate Risk';
  return 'High Risk (At Risk)';
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---- Auth guard ----
// Every protected page calls one of these before rendering anything.
// Returns the session user object, or redirects and returns null.

async function requireFacultySession() {
  try {
    const user = await apiRequest('/auth/me');
    if (user.role !== 'faculty') { window.location.href = 'portal.html'; return null; }
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = user.name;
    return user;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}

async function requireStudentSession() {
  try {
    const user = await apiRequest('/auth/me');
    if (user.role !== 'student') { window.location.href = 'index.html'; return null; }
    return user;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}

function wireLogout() {
  const link = document.getElementById('logoutLink') || document.getElementById('logoutBtn');
  if (!link) return;
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
    window.location.href = 'login.html';
  });
}

// ---- Login page ----

function initLoginPage() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  // If already logged in, skip straight to the right place.
  apiRequest('/auth/me').then(user => {
    window.location.href = user.role === 'faculty' ? 'index.html' : 'portal.html';
  }).catch(() => { /* not logged in, stay on this page */ });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
      const user = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      window.location.href = user.role === 'faculty' ? 'index.html' : 'portal.html';
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---- Faculty dashboard page (index.html) ----

async function loadStats() {
  const statTotal = document.getElementById('statTotal');
  if (!statTotal) return;
  try {
    const stats = await apiRequest('/stats');
    statTotal.textContent = stats.total.toLocaleString();
    document.getElementById('statAtRisk').textContent = stats.atRisk.toLocaleString();
    document.getElementById('statAvgAttendance').textContent = stats.total ? `${stats.avgAttendance}%` : '—';
  } catch (err) {
    statTotal.textContent = '—';
  }
}

async function evaluateStudent() {
  const name = document.getElementById('studentName').value.trim();
  const attendance = document.getElementById('attendance').value;
  const marks = document.getElementById('marks').value;
  const assignments = document.getElementById('assignments').value;
  const createPortal = document.getElementById('createPortalToggle') && document.getElementById('createPortalToggle').checked;
  const portalEmail = createPortal ? document.getElementById('portalEmail').value.trim() : '';
  const portalPassword = createPortal ? document.getElementById('portalPassword').value : '';

  if (!name || attendance === '' || marks === '' || assignments === '') {
    alert('Fill in a name, attendance, marks, and assignments before evaluating.');
    return;
  }
  if (createPortal && (!portalEmail || !portalPassword)) {
    alert('Add both an email and a password to set up portal access, or uncheck that option.');
    return;
  }

  try {
    const body = { name, attendance, marks, assignments };
    if (createPortal) { body.email = portalEmail; body.password = portalPassword; }

    const student = await apiRequest('/students', { method: 'POST', body: JSON.stringify(body) });

    const resultCard = document.getElementById('result-card');
    const badge = document.getElementById('risk-badge');
    badge.className = 'badge ' + riskBadgeClass(student.risk.level);
    badge.textContent = riskLabel(student.risk.level);
    document.getElementById('res-title').textContent = `${student.name} — risk score ${student.risk.score}/100`;
    document.getElementById('res-recommendation').textContent = student.risk.recommendation
      + (student.hasPortalAccess ? ' Portal access has been created — share the login with the student.' : '');
    resultCard.style.display = 'block';

    document.getElementById('studentName').value = '';
    document.getElementById('attendance').value = '';
    document.getElementById('marks').value = '';
    document.getElementById('assignments').value = '';
    if (createPortal) {
      document.getElementById('portalEmail').value = '';
      document.getElementById('portalPassword').value = '';
      document.getElementById('createPortalToggle').checked = false;
      document.getElementById('portalFields').style.display = 'none';
    }

    loadStats();
  } catch (err) {
    alert(err.message);
  }
}

// ---- Students directory page (students.html) ----

async function loadStudentsTable() {
  const tbody = document.getElementById('studentsTableBody');
  if (!tbody) return;
  try {
    const students = await apiRequest('/students');
    if (!students.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: var(--text-muted); text-align:center; padding: 2rem 0;">No students yet. Add one from the Dashboard's evaluator.</td></tr>`;
      return;
    }
    tbody.innerHTML = students.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${s.attendance}%</td>
        <td>${s.marks}%</td>
        <td>${s.assignments}%</td>
        <td><span class="badge ${riskBadgeClass(s.risk.level)}">${riskLabel(s.risk.level)}</span></td>
        <td><span class="portal-status ${s.hasPortalAccess ? 'active' : ''}">${s.hasPortalAccess ? 'Active' : '—'}</span></td>
        <td><button class="remove-btn" data-id="${s.id}" title="Remove"><i class="fa-solid fa-trash"></i></button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiRequest(`/students/${btn.dataset.id}`, { method: 'DELETE' });
          loadStudentsTable();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color: var(--danger); text-align:center; padding: 2rem 0;">Couldn't load students — check that the server is running.</td></tr>`;
  }
}

// ---- Settings page: change password ----

function initPasswordForm() {
  const form = document.getElementById('passwordForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const msg = document.getElementById('passwordMsg');
    try {
      await apiRequest('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
      msg.style.color = 'var(--success)';
      msg.textContent = 'Password updated.';
      form.reset();
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message;
    }
  });
}

// ---- Student portal page (portal.html) ----

async function loadPortal(user) {
  const content = document.getElementById('portalContent');
  document.getElementById('portalUserName').textContent = user.name;
  document.getElementById('portalGreeting').textContent = `Welcome back, ${user.name.split(' ')[0]}`;

  try {
    const student = await apiRequest('/me/student');
    const r = student.risk;
    content.innerHTML = `
      <div class="portal-risk-banner ${riskBadgeClass(r.level)}">
        <span class="badge ${riskBadgeClass(r.level)}">${riskLabel(r.level)}</span>
        <h2>Overall standing: ${r.score}/100</h2>
        <p>${escapeHtml(r.recommendation)}</p>
      </div>
      <div class="portal-metrics">
        <div class="portal-metric">
          <div class="metric-value">${student.attendance}%</div>
          <div class="metric-label">Attendance</div>
        </div>
        <div class="portal-metric">
          <div class="metric-value">${student.marks}%</div>
          <div class="metric-label">Exam Marks</div>
        </div>
        <div class="portal-metric">
          <div class="metric-value">${student.assignments}%</div>
          <div class="metric-label">Assignments Done</div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<p style="color: var(--danger);">Couldn't load your record — ask your teacher to check your portal account is linked correctly.</p>`;
  }
}

// ---- Init: figure out which page we're on ----

document.addEventListener('DOMContentLoaded', async () => {
  wireLogout();

  if (document.getElementById('loginForm')) {
    initLoginPage();
    return;
  }

  if (document.getElementById('portalContent')) {
    const user = await requireStudentSession();
    if (user) loadPortal(user);
    return;
  }

  // Otherwise this is a faculty page: index.html, students.html, analytics.html, settings.html
  const user = await requireFacultySession();
  if (!user) return;

  loadStats();
  loadStudentsTable();
  initPasswordForm();
});
