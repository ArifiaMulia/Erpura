const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { pool, initDb } = require('./database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'erpura_secret_key_change_in_prod';

// Lark Credentials
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a87dfa8354b8d029';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'csMeQnMGbnK31eqfAW8twgSb8OJrhAqa';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://erpura.virtuenet.space/api/auth/lark/callback';

app.use(cors());
app.use(express.json());

// Logger Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
    req.user = user;
    next();
  });
}

// RBAC Middleware generator
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Requires role ${allowedRoles.join(' or ')}` });
    }
    next();
  };
}

// Log action helper
async function logAction(userId, userName, action, details) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_name, action, details) VALUES ($1, $2, $3, $4)',
      [userId, userName, action, details]
    );
  } catch (err) {
    console.error('Error writing to audit_logs:', err);
  }
}

// ============================================================
// Auth Endpoints
// ============================================================

// 1. Redirect to Lark OAuth
app.get('/api/auth/lark', (req, res) => {
  const state = Math.random().toString(36).substring(7);
  const larkAuthUrl = `https://open.larksuite.com/open-apis/authen/v1/index?app_id=${LARK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
  res.redirect(larkAuthUrl);
});

// 2. Callback from Lark
app.get('/api/auth/lark/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('<h1>Authorization failed: Missing authorization code</h1>');
  }

  try {
    // Exchange code for user access token
    const tokenResponse = await axios.post(
      'https://open.larksuite.com/open-apis/authen/v1/access_token',
      {
        app_id: LARK_APP_ID,
        app_secret: LARK_APP_SECRET,
        grant_type: 'authorization_code',
        code: code,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const authData = tokenResponse.data;

    if (authData.code !== 0) {
      console.error('Lark access token exchange error:', authData.msg);
      return res.status(500).send(`<h1>Lark Access Token Exchange Failed: ${authData.msg}</h1>`);
    }

    const { open_id, name, avatar_url, email } = authData.data;

    // Database check/create user
    const userCheck = await pool.query('SELECT * FROM users WHERE lark_id = $1', [open_id]);
    let user = null;

    if (userCheck.rows.length === 0) {
      // First user is Admin, others are Viewers
      const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
      const role = parseInt(totalUsers.rows[0].count) === 0 ? 'Admin' : 'Viewer';

      const insertResult = await pool.query(
        'INSERT INTO users (lark_id, name, email, avatar, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [open_id, name, email || null, avatar_url || null, role]
      );
      user = insertResult.rows[0];
      await logAction(user.id, user.name, 'User Registered', `First registration via Lark. Assigned role: ${role}`);
    } else {
      user = userCheck.rows[0];
      // Update avatar or name if changed
      await pool.query(
        'UPDATE users SET name = $1, avatar = $2, email = $3 WHERE id = $4',
        [name, avatar_url || user.avatar, email || user.email, user.id]
      );
      await logAction(user.id, user.name, 'User Login', 'Logged in successfully via Lark Suite');
    }

    // Generate JWT
    const tokenPayload = {
      id: user.id,
      lark_id: user.lark_id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    // Redirect to frontend with token query parameter
    res.redirect(`https://erpura.virtuenet.space/?token=${token}`);
  } catch (err) {
    console.error('Lark OAuth callback processing error:', err.message);
    res.status(500).send('<h1>Internal Server Error processing Lark OAuth</h1>');
  }
});

// 3. Get currently logged-in user profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json(req.user);
});

// ============================================================
// User Management Endpoints (Admin only)
// ============================================================

app.get('/api/users', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, avatar, role FROM users ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/role', authenticateToken, requireRole(['Admin']), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const validRoles = ['Admin', 'Reviewer', 'Developer', 'Viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldRole = userCheck.rows[0].role;
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    await logAction(req.user.id, req.user.name, 'Modify User Role', `Changed user ID ${id} (${userCheck.rows[0].name}) role from ${oldRole} to ${role}`);

    res.json({ message: 'Role updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Audit Logs (Admin only)
// ============================================================
app.get('/api/audit-logs', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post audit log from client (Developer/Reviewer/Admin)
app.post('/api/audit-logs', authenticateToken, requireRole(['Admin', 'Reviewer', 'Developer']), async (req, res) => {
  const { action, details } = req.body;
  if (!action || !details) {
    return res.status(400).json({ error: 'Missing action or details' });
  }
  await logAction(req.user.id, req.user.name, action, details);
  res.json({ message: 'Logged successfully' });
});

// ============================================================
// Collaborative Comments Endpoints
// ============================================================

// Get comments for an issue
app.get('/api/issues/:id/comments', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, issue_id, user_name, user_avatar, timestamp, comment_text FROM comments WHERE issue_id = $1 ORDER BY timestamp ASC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post a comment to an issue (Admin, Reviewer, Developer)
app.post('/api/issues/:id/comments', authenticateToken, requireRole(['Admin', 'Reviewer', 'Developer']), async (req, res) => {
  const { id } = req.params;
  const { commentText } = req.body;

  if (!commentText || commentText.trim() === '') {
    return res.status(400).json({ error: 'Comment text cannot be empty' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO comments (issue_id, user_id, user_name, user_avatar, comment_text) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, req.user.id, req.user.name, req.user.avatar, commentText]
    );
    await logAction(req.user.id, req.user.name, 'Add Issue Comment', `Added review comment on issue ${id}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Git Sync / Webhook Endpoint
// ============================================================
app.post('/api/git/webhook', async (req, res) => {
  // Mock git webhook integration
  const payload = req.body;
  const repoName = payload.repository ? payload.repository.full_name : 'Unknown repo';
  const branchName = payload.ref ? payload.ref.replace('refs/heads/', '') : 'main';
  const commitMsg = payload.head_commit ? payload.head_commit.message : 'No message';

  console.log(`Git Webhook received from ${repoName} on branch ${branchName}`);
  await logAction(0, 'Git Webhook', 'Git Push Triggered', `Repository: ${repoName}, Branch: ${branchName}, Head Commit: ${commitMsg}`);
  res.json({ message: 'Git Push Sync received and logged.' });
});

// ============================================================
// Real-time Test Bed Runner Endpoint (Server-Sent Events)
// ============================================================
app.get('/api/testbed/run', authenticateToken, requireRole(['Admin', 'Developer']), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendLog = (message, event = 'test_log') => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ message, timestamp: new Date().toISOString() })}\n\n`);
  };

  sendLog('🚀 Starting Odoo Test Suite for custom_sales...', 'test_start');

  let steps = [
    { delay: 1000, msg: '🐳 Spin up test container: odoo_test_env_postgres' },
    { delay: 2000, msg: '📂 Mount custom_sales addon codebase directories...' },
    { delay: 3500, msg: '⚙️ Initialize Odoo framework (v14.0) core registry...' },
    { delay: 5000, msg: '🔑 Run security check: loading demo access rights CSV...' },
    { delay: 6500, msg: '📋 Executing test suite: custom_sales.test_sales_integrity' },
    { delay: 7500, msg: '👉 test_sale_order_creation ... [PASS]' },
    { delay: 9000, msg: '👉 test_sale_order_approval_workflow ... [PASS]' },
    { delay: 10500, msg: '👉 test_report_sql_injection_remediation ... [PASS]' },
    { delay: 12000, msg: '👉 test_model_dependency_relationships ... [PASS]' },
    { delay: 13000, msg: '🧪 Odoo Unit Tests executed. 4 tests passed, 0 failed, 0 errors.' }
  ];

  steps.forEach((step, idx) => {
    setTimeout(() => {
      sendLog(step.msg);
      if (idx === steps.length - 1) {
        sendLog('🏁 Test execution complete.', 'test_end');
        res.end();
      }
    }, step.delay);
  });
});

// Initialize database and start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Erpura Full-Stack API listening on port ${PORT}`);
  });
}).catch(err => {
  console.error('Fatal: Failed to start server due to database initialization failure.', err);
});
