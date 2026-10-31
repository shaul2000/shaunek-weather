# Initial threat model
| Asset | Threat | Initial control |
|---|---|---|
| User passwords | Database leak | Argon2id hashes; never log passwords |
| Sessions | Session theft/fixation | HttpOnly cookie; regenerate on login/register; expiry |
| State-changing requests | CSRF | Session-bound random token in custom header |
| Saved locations | IDOR/BOLA | Every query includes authenticated user ID |
| Database | SQL injection | Parameterized SQL; input validation |
| API | Brute force / resource abuse | Auth rate limit, JSON body limit, upstream timeout |
| Secrets | Repository exposure | Environment variables and `.gitignore` |

This is an initial design exercise, not proof of security. Add automated tests, dependency scanning, secret scanning, monitoring, backup/restore tests and an independent review before production.
