# Architecture
Browser -> Node/Express API -> PostgreSQL
                         -> private Python/FastAPI weather service -> Open-Meteo

Node is the public application boundary: authentication, sessions, validation, authorization and persistence live there. Python has one focused responsibility: retrieve and normalize weather data. The browser never connects directly to PostgreSQL or the Python service.

The API serves the frontend in the local Docker setup. For a separate Vercel frontend, configure an exact allowed origin and secure cross-site cookies; verify browser cookie behavior before launch.
