import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import argon2 from 'argon2';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['DATABASE_URL', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (process.env.NODE_ENV === 'production' && process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
const PgSession = connectPgSimple(session);
const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
const secureCookie = process.env.COOKIE_SECURE === 'true';

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';
app.use(cors({
  origin: frontendOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token']
}));
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", frontendOrigin].filter(Boolean),
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
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
const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const citySchema = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{M}\s,.'-]+$/u);

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
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  next();
}
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));
app.get('/api/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: csrfToken(req) });
});

app.post('/api/auth/register', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and a password of at least 12 characters.' });
  const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
  try {
    const result = await pool.query(
      'INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email',
      [parsed.data.email, passwordHash]
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
  const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [parsed.data.email]);
  const user = result.rows[0];
  if (!user || !(await argon2.verify(user.password_hash, parsed.data.password))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not create session' });
    req.session.user = { id: user.id, email: user.email };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save(e => e ? res.status(500).json({ error: 'Could not save session' }) : res.json({ user: req.session.user, csrfToken: req.session.csrfToken }));
  });
}));

app.post('/api/auth/logout', requireCsrf, asyncRoute(async (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.clearCookie('shaunek.sid', { httpOnly: true, secure: secureCookie, sameSite, path: '/' });
    res.status(204).end();
  });
}));
app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));

app.get('/api/weather', asyncRoute(async (req, res) => {
  const parsed = z.object({ city: citySchema }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid city name.' });
  const base = process.env.WEATHER_SERVICE_URL || 'http://127.0.0.1:8001';
  const response = await fetch(`${base}/weather?city=${encodeURIComponent(parsed.data.city)}`, { signal: AbortSignal.timeout(12000) });
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
app.use(express.static(frontendPath));
app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Shaunek Weather API listening on ${port}`));
