import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import argon2 from 'argon2';
import helmet from 'helmet';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
  if (process.env.COOKIE_SECURE !== 'true') {
    throw new Error('COOKIE_SECURE=true is required in production');
  }
  if (!process.env.FRONTEND_ORIGIN || !process.env.PUBLIC_APP_URL) {
    throw new Error('FRONTEND_ORIGIN and PUBLIC_APP_URL must be configured in production');
  }
}

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
const PgSession = connectPgSimple(session);
const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
const secureCookie = process.env.COOKIE_SECURE === 'true';
if (!['lax', 'strict', 'none'].includes(sameSite)) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
}
if (sameSite === 'none' && !secureCookie) {
  throw new Error('COOKIE_SECURE=true is required when COOKIE_SAME_SITE=none');
}

function configuredOrigin(name, value, fallback) {
  let url;
  try {
    url = new URL(value || fallback);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP or HTTPS origin without a path`);
  }
  if (isProduction && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in production`);
  }
  return url.origin;
}

const frontendOrigin = configuredOrigin(
  'FRONTEND_ORIGIN',
  process.env.FRONTEND_ORIGIN,
  'http://localhost:8080'
);
const publicAppUrl = configuredOrigin(
  'PUBLIC_APP_URL',
  process.env.PUBLIC_APP_URL,
  frontendOrigin
);
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpFrom = process.env.SMTP_FROM?.trim();
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

if (smtpHost || smtpFrom || smtpUser || smtpPassword) {
  if (!smtpHost || !smtpFrom) {
    throw new Error('SMTP_HOST and SMTP_FROM must both be configured to enable password reset');
  }
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('SMTP_PORT must be a valid port number');
  }
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  }
}

const mailer = smtpHost
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      ...(smtpUser && smtpPassword ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      disableFileAccess: true,
      disableUrlAccess: true
    })
  : null;

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(cors({
  origin: frontendOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token']
}));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== frontendOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", frontendOrigin].filter(Boolean),
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: isProduction ? [] : null
  }
}}));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'shaunek.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: secureCookie, sameSite, maxAge: 1000 * 60 * 60 * 8, path: '/' }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const accountChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const adminBootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const citySchema = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{M}\s,.'-]+$/u);
const countrySchema = z.string().regex(/^[A-Z]{2}$/);
const regionSchema = z.string().trim().max(100).default('');
const timezoneSchema = z.string().trim().min(1).max(64).refine(value => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Choose a valid time zone.');
const passwordResetMessage = 'If an account exists for that email, a reset link will be sent.';
const adminUsername = 'shauAdmin';
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
const adminBootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN?.trim() || '';
if (adminEmail && !emailSchema.safeParse(adminEmail).success) {
  throw new Error('ADMIN_EMAIL must be a valid email address');
}
if (adminBootstrapToken && adminBootstrapToken.length < 32) {
  throw new Error('ADMIN_BOOTSTRAP_TOKEN must be at least 32 characters');
}

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}
function requireCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token');
  const expected = req.session.csrfToken;
  if (typeof supplied !== 'string' || typeof expected !== 'string' ||
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
const requireAuth = asyncRoute(async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  const result = await pool.query(
    'SELECT blocked_at FROM users WHERE id = $1',
    [req.session.user.id]
  );
  if (!result.rows[0]) return res.status(401).json({ error: 'Please log in' });
  if (result.rows[0].blocked_at) {
    return res.status(403).json({ error: 'This account has been blocked.' });
  }
  next();
});
const requireAdmin = asyncRoute(async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  if (!adminEmail) return res.status(403).json({ error: 'Administrator access is not configured' });

  const result = await pool.query(
    'SELECT email, is_admin, blocked_at FROM users WHERE id = $1',
    [req.session.user.id]
  );
  if (!result.rows[0]?.is_admin ||
      result.rows[0].email.toLowerCase() !== adminEmail ||
      result.rows[0].blocked_at) {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
});

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));
app.get('/api/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: csrfToken(req) });
});

app.post('/api/auth/register', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const parsed = z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: passwordSchema,
    country: countrySchema,
    region: regionSchema,
    timezone: timezoneSchema
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Enter your name, a valid email and password, and select a country and time zone.'
    });
  }
  if (adminEmail && parsed.data.email === adminEmail) {
    return res.status(403).json({ error: 'This email is reserved for the configured administrator account.' });
  }
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  try {
    const result = await pool.query(
      `INSERT INTO users(first_name, last_name, email, password_hash, country, region, timezone)
       VALUES($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email`,
      [
        parsed.data.firstName,
        parsed.data.lastName,
        parsed.data.email,
        passwordHash,
        parsed.data.country,
        parsed.data.region,
        parsed.data.timezone
      ]
    );
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Could not create session' });
      req.session.user = { id: result.rows[0].id, email: result.rows[0].email };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save(e => e ? res.status(500).json({ error: 'Could not save session' }) : res.status(201).json({ user: req.session.user, csrfToken: req.session.csrfToken }));
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    throw err;
  }
}));

app.post('/api/auth/login', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password.' });
  const result = await pool.query(
    'SELECT id, email, password_hash, blocked_at FROM users WHERE email = $1',
    [parsed.data.email]
  );
  const user = result.rows[0];
  if (!user || !(await argon2.verify(user.password_hash, parsed.data.password))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.blocked_at) {
    return res.status(403).json({ error: 'This account has been blocked. Contact support.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not create session' });
    req.session.user = { id: user.id, email: user.email };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save(e => e ? res.status(500).json({ error: 'Could not save session' }) : res.json({ user: req.session.user, csrfToken: req.session.csrfToken }));
  });
}));

app.post('/api/auth/forgot-password', passwordResetLimiter, requireCsrf, asyncRoute(async (req, res) => {
  if (!mailer) {
    return res.status(503).json({ error: 'Password reset email is not configured on this server.' });
  }

  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });

  const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [parsed.data.email]);
  const user = result.rows[0];
  if (!user) return res.status(202).json({ message: passwordResetMessage });

  const token = crypto.randomBytes(32).toString('base64url');
  // Store only the hash so a database read cannot expose a usable reset link.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
  await pool.query(
    `INSERT INTO password_reset_tokens(token_hash, user_id, expires_at)
     VALUES($1, $2, NOW() + INTERVAL '1 hour')`,
    [tokenHash, user.id]
  );

  const resetUrl = new URL('/reset-password.html', publicAppUrl);
  resetUrl.searchParams.set('token', token);
  const resetLinkHtml = resetUrl.href.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  try {
    await mailer.sendMail({
      from: smtpFrom,
      to: user.email,
      subject: 'Reset your Shaunek Weather password',
      text: `Use this link to reset your Shaunek Weather password. It expires in one hour:\n\n${resetUrl.href}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your Shaunek Weather password.</p><p><a href="${resetLinkHtml}">Reset your password</a></p><p>This link expires in one hour. If you did not request a reset, you can ignore this email.</p>`
    });
  } catch (error) {
    console.error('Password reset email delivery failed:', error.code || 'unknown error');
  }

  res.status(202).json({ message: passwordResetMessage });
}));

app.post('/api/auth/reset-password', passwordResetLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const parsed = z.object({
    token: z.string().min(32).max(128),
    password: passwordSchema
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enter a valid reset link and a password of at least 12 characters.' });
  }

  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  const client = await pool.connect();

  try {
    // Consume the token and change the password atomically.
    await client.query('BEGIN');
    const consumed = await client.query(
      `DELETE FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    );

    if (!consumed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This password reset link is invalid or has expired. Request a new one.' });
    }

    const userId = consumed.rows[0].user_id;
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query(
      `DELETE FROM user_sessions
       WHERE sess->'user'->>'id' = $1`,
      [String(userId)]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.json({ message: 'Your password has been updated. You can now log in.' });
}));

app.post('/api/auth/logout', requireCsrf, asyncRoute(async (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.clearCookie('shaunek.sid', { httpOnly: true, secure: secureCookie, sameSite, path: '/' });
    res.status(204).end();
  });
}));
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  let user = req.session.user || null;
  let hasAdminRole = false;
  if (user) {
    const result = await pool.query(
      'SELECT email, is_admin, blocked_at FROM users WHERE id = $1',
      [user.id]
    );
    if (!result.rows[0] || result.rows[0].blocked_at) {
      user = null;
    } else {
      hasAdminRole = result.rows[0].is_admin;
    }
  }
  const isAdmin = Boolean(
    adminEmail && hasAdminRole && user?.email?.toLowerCase() === adminEmail
  );
  res.json({
    user,
    isAdmin,
    adminUsername: isAdmin ? adminUsername : null
  });
}));

app.post('/api/admin/bootstrap', adminBootstrapLimiter, requireCsrf, asyncRoute(async (req, res) => {
  if (!adminEmail || !adminBootstrapToken) {
    return res.status(503).json({ error: 'Administrator bootstrap is not configured.' });
  }

  const parsed = z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: passwordSchema,
    setupToken: z.string().min(32).max(256)
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Enter the configured administrator email, names, a password of at least 12 characters, and the setup token.'
    });
  }

  const suppliedToken = Buffer.from(parsed.data.setupToken);
  const expectedToken = Buffer.from(adminBootstrapToken);
  if (suppliedToken.length !== expectedToken.length ||
      !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
    return res.status(403).json({ error: 'Invalid administrator setup token.' });
  }
  if (parsed.data.email !== adminEmail) {
    return res.status(400).json({ error: 'The email must match the configured administrator email.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize first-admin creation before a role row exists to lock.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('shaunek-admin-bootstrap', 0))"
    );
    const existingAdmin = await client.query(
      'SELECT id FROM users WHERE is_admin = TRUE LIMIT 1 FOR UPDATE'
    );
    if (existingAdmin.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An administrator account has already been provisioned.' });
    }

    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const result = await client.query(
      `INSERT INTO users(first_name, last_name, email, password_hash, is_admin)
       VALUES($1, $2, $3, $4, TRUE)
       ON CONFLICT(email) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           password_hash = EXCLUDED.password_hash,
           blocked_at = NULL,
           is_admin = TRUE
       RETURNING id, email`,
      [
        parsed.data.firstName,
        parsed.data.lastName,
        parsed.data.email,
        passwordHash
      ]
    );
    const userId = result.rows[0].id;
    await client.query(
      `DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1`,
      [String(userId)]
    );
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM email_change_tokens WHERE user_id = $1', [userId]);
    await client.query('COMMIT');

    res.status(201).json({
      user: result.rows[0],
      adminUsername,
      message: 'Administrator account provisioned. Sign in with the new password.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An administrator account has already been provisioned.' });
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid user-list pagination.' });
  }

  const [count, users] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM users'),
    pool.query(
      `SELECT id, first_name, last_name, email, created_at, blocked_at, is_admin
       FROM users
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [parsed.data.limit, parsed.data.offset]
    )
  ]);
  res.json({
    users: users.rows,
    total: count.rows[0].total,
    limit: parsed.data.limit,
    offset: parsed.data.offset
  });
}));

async function updateUserBlockStatus(userId, blocked) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      'SELECT email, is_admin FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return { status: 404 };
    }
    if (target.rows[0].is_admin) {
      await client.query('ROLLBACK');
      return { status: 403 };
    }

    await client.query(
      `UPDATE users
       SET blocked_at = CASE WHEN $1 THEN COALESCE(blocked_at, NOW()) ELSE NULL END
       WHERE id = $2`,
      [blocked, userId]
    );
    if (blocked) {
      await client.query(
        `DELETE FROM user_sessions
         WHERE sess->'user'->>'id' = $1`,
        [userId]
      );
    }
    await client.query('COMMIT');
    return { status: 200 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setUserBlockStatus(req, res, blocked) {
  const parsed = z.string()
    .regex(/^[1-9]\d{0,18}$/)
    .refine(value => value.length < 19 || value <= '9223372036854775807')
    .safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid user ID.' });

  const result = await updateUserBlockStatus(parsed.data, blocked);
  if (result.status === 404) return res.status(404).json({ error: 'Account not found.' });
  if (result.status === 403) {
    return res.status(403).json({ error: 'The administrator account cannot be blocked.' });
  }
  res.json({ userId: parsed.data, isBlocked: blocked });
}

app.post(
  '/api/admin/users/:id/block',
  requireCsrf,
  adminActionLimiter,
  requireAdmin,
  asyncRoute(async (req, res) => setUserBlockStatus(req, res, true))
);
app.post(
  '/api/admin/users/:id/unblock',
  requireCsrf,
  adminActionLimiter,
  requireAdmin,
  asyncRoute(async (req, res) => setUserBlockStatus(req, res, false))
);

app.get('/api/account/settings', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT u.first_name, u.last_name, u.email, u.country, u.region, u.timezone,
            u.created_at, pending.pending_email
     FROM users u
     LEFT JOIN LATERAL (
       SELECT pending_email
       FROM email_change_tokens
       WHERE user_id = u.id AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
     ) pending ON true
     WHERE u.id = $1`,
    [req.session.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: result.rows[0] });
}));

app.post('/api/account/profile', requireAuth, requireCsrf, accountChangeLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    country: countrySchema,
    region: regionSchema,
    timezone: timezoneSchema
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Enter your name, select a country and time zone, and check the region field.'
    });
  }

  const result = await pool.query(
    `UPDATE users
     SET first_name = $1, last_name = $2, country = $3, region = $4, timezone = $5
     WHERE id = $6
     RETURNING first_name, last_name, email, country, region, timezone`,
    [
      parsed.data.firstName,
      parsed.data.lastName,
      parsed.data.country,
      parsed.data.region,
      parsed.data.timezone,
      req.session.user.id
    ]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: result.rows[0] });
}));

app.post('/api/account/email-change', requireAuth, requireCsrf, accountChangeLimiter, asyncRoute(async (req, res) => {
  if (!mailer) {
    return res.status(503).json({ error: 'Email verification is not configured on this server.' });
  }
  const parsed = z.object({
    email: emailSchema,
    currentPassword: z.string().min(1).max(128)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address and your current password.' });

  const accountResult = await pool.query(
    'SELECT email, password_hash FROM users WHERE id = $1',
    [req.session.user.id]
  );
  const account = accountResult.rows[0];
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!(await argon2.verify(account.password_hash, parsed.data.currentPassword))) {
    return res.status(403).json({ error: 'Your current password is incorrect.' });
  }
  if (parsed.data.email === account.email) {
    return res.status(400).json({ error: 'Enter an email address different from your current one.' });
  }
  if (parsed.data.email === adminEmail && account.email.toLowerCase() !== adminEmail) {
    return res.status(403).json({ error: 'This email is reserved for the configured administrator account.' });
  }

  const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [parsed.data.email]);
  if (existing.rowCount) return res.status(409).json({ error: 'That email address is already associated with an account.' });

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('DELETE FROM email_change_tokens WHERE user_id = $1', [req.session.user.id]);
  await pool.query(
    `INSERT INTO email_change_tokens(token_hash, user_id, pending_email, expires_at)
     VALUES($1, $2, $3, NOW() + INTERVAL '1 hour')`,
    [tokenHash, req.session.user.id, parsed.data.email]
  );

  const verificationUrl = new URL('/verify-email.html', publicAppUrl);
  verificationUrl.searchParams.set('token', token);
  const verificationLink = verificationUrl.href.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  try {
    await mailer.sendMail({
      from: smtpFrom,
      to: parsed.data.email,
      subject: 'Confirm your Shaunek Weather email address',
      text: `Confirm your new email address using this link. It expires in one hour:\n\n${verificationUrl.href}\n\nIf you did not request this change, you can ignore this email.`,
      html: `<p>Confirm your new Shaunek Weather email address.</p><p><a href="${verificationLink}">Confirm email address</a></p><p>This link expires in one hour. If you did not request this change, you can ignore this email.</p>`
    });
  } catch (error) {
    console.error('Email change verification delivery failed:', error.code || 'unknown error');
    await pool.query('DELETE FROM email_change_tokens WHERE token_hash = $1', [tokenHash]);
    return res.status(502).json({ error: 'The verification email could not be sent. Please try again later.' });
  }

  res.status(202).json({ message: 'Check your new email address to confirm the change. The link expires in one hour.' });
}));

app.post('/api/account/email-change/confirm', requireCsrf, accountChangeLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ token: z.string().min(32).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'This email confirmation link is invalid or has expired.' });

  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consumed = await client.query(
      `DELETE FROM email_change_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id, pending_email`,
      [tokenHash]
    );
    if (!consumed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This email confirmation link is invalid or has expired.' });
    }

    const { user_id: userId, pending_email: email } = consumed.rows[0];
    if (adminEmail && email === adminEmail) {
      const current = await client.query(
        'SELECT email FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (current.rows[0]?.email.toLowerCase() !== adminEmail) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'This email is reserved for the configured administrator account.'
        });
      }
    }
    await client.query('UPDATE users SET email = $1 WHERE id = $2', [email, userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query(
      `UPDATE user_sessions
       SET sess = jsonb_set(sess::jsonb, '{user,email}', to_jsonb($2::text))::json
       WHERE sess->'user'->>'id' = $1`,
      [String(userId), email]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email address is already associated with another account.' });
    }
    throw error;
  } finally {
    client.release();
  }

  res.json({ message: 'Your email address has been verified and updated.' });
}));

app.post('/api/account/password', requireAuth, requireCsrf, accountChangeLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your current password and a new password of at least 12 characters.' });

  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Account not found' });
  if (!(await argon2.verify(result.rows[0].password_hash, parsed.data.currentPassword))) {
    return res.status(403).json({ error: 'Your current password is incorrect.' });
  }
  const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.session.user.id]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [req.session.user.id]);
    await client.query(
      `DELETE FROM user_sessions
       WHERE sess->'user'->>'id' = $1 AND sid <> $2`,
      [String(req.session.user.id), req.sessionID]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.json({ message: 'Password updated. Other signed-in sessions have been ended.' });
}));

app.get('/api/weather', asyncRoute(async (req, res) => {
  const parsed = z.object({ city: citySchema }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid city name.' });
  const base = process.env.WEATHER_SERVICE_URL || 'http://127.0.0.1:8001';
  // Keep the browser-facing API separate from the private weather-service route.
  const response = await fetch(`${base}/weather?city=${encodeURIComponent(parsed.data.city)}`, { signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(response.status).json({ error: data.detail || 'Weather service unavailable' });
  res.json(data);
}));

app.get('/api/weather/featured', asyncRoute(async (req, res) => {
  const parsed = z.object({
    offset: z.coerce.number().int().min(0).max(1000).default(0),
    limit: z.coerce.number().int().min(1).max(8).default(8),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid featured weather page.' });

  const base = process.env.WEATHER_SERVICE_URL || 'http://127.0.0.1:8001';
  const query = new URLSearchParams({
    offset: String(parsed.data.offset),
    limit: String(parsed.data.limit),
  });
  const response = await fetch(`${base}/featured?${query}`, { signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(response.status).json({ error: data.detail || 'Weather service unavailable' });
  res.json(data);
}));

app.get('/api/locations', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT id, city, created_at FROM saved_locations WHERE user_id = $1 ORDER BY created_at DESC', [req.session.user.id]);
  res.json({ locations: result.rows });
}));
app.post('/api/locations', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const parsed = z.object({ city: citySchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid city name.' });
  const result = await pool.query(
    'INSERT INTO saved_locations(user_id, city) VALUES($1, $2) ON CONFLICT(user_id, city) DO NOTHING RETURNING id, city',
    [req.session.user.id, parsed.data.city]
  );
  res.status(201).json({ location: result.rows[0] || null });
}));
app.delete('/api/locations/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid location ID' });
  const result = await pool.query('DELETE FROM saved_locations WHERE id = $1 AND user_id = $2', [id, req.session.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Location not found' });
  res.status(204).end();
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = path.resolve(__dirname, '../../frontend');
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
    `User-agent: *\nAllow: /\nSitemap: ${publicAppUrl}/sitemap.xml\n`
  );
});
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${publicAppUrl}/</loc></url>\n` +
    `</urlset>\n`
  );
});
app.use(express.static(frontendPath));
app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});
const port = Number(process.env.PORT || 8080);
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
`);
await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin_idx
  ON users (is_admin) WHERE is_admin
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens(user_id)
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS email_change_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pending_email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS email_change_tokens_user_id_idx
  ON email_change_tokens(user_id)
`);
app.listen(port, () => console.log(`Shaunek Weather API listening on ${port}`));
