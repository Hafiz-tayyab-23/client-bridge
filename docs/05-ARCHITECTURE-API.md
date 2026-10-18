# Architecture and API decisions

Fill only after the live prompt and rules are captured. Keep the system as simple as possible while meeting explicit requirements.

## Stack decision
| Layer | Choice | Why it fits the prompt / team / deadline |
|---|---|---|
| Frontend | | |
| Backend | | |
| Database | | |
| Hosting | | |

## System shape
Describe the app, services, database, and external integrations in a few lines. Split into independently runnable services only when required or clearly valuable.

## Data and access
| Entity | Important fields | Owner / access rules | Demo data? |
|---|---|---|---|
| | | | |

- Keep privileged credentials server-side.
- Explain how sensitive or personal data is protected.
- Explain how aggregate queries avoid exposing individual records.
- Seed a small, labeled, deterministic dataset if analytics require data.

## API contract
| Method + path | Purpose | Request | Response | Error cases | Owner |
|---|---|---|---|---|---|
| | | | | | |

## Local run commands
| App/service | Command | Port | Health / smoke check |
|---|---|---|---|
| | | | |

## Deployment
- Production URL:
- Environment variable names (never values):
- Deployment owner:
- Rollback / local fallback:
