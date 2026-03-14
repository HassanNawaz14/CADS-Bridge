# CADS-Bridge — Complete VS Code Setup Guide

> **Stack:** React + Express + SQL Server (MERN-style, SQL instead of Mongo)  
> **Prereqs:** Node.js ≥ 18, SQL Server (or Docker), VS Code

---

## 1. Prerequisites — Install These First

### Node.js (v18 or later)
```
https://nodejs.org → Download LTS → Install
Verify: node -v   (should show v18.x or v20.x)
Verify: npm -v    (should show 9.x or 10.x)
```

### SQL Server
**Option A — SQL Server Developer Edition (Windows, free)**
```
https://www.microsoft.com/en-us/sql-server/sql-server-downloads
→ Download Developer Edition → Install with default settings
→ Note your SA password during setup
```

**Option B — Docker (any OS, easiest)**
```bash
# Install Docker Desktop first: https://www.docker.com/products/docker-desktop
docker pull mcr.microsoft.com/mssql/server:2022-latest
docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=YourStrong@Passw0rd" \
  -p 1433:1433 --name cads-sqlserver -d \
  mcr.microsoft.com/mssql/server:2022-latest
```

### VS Code Extensions (install from Extensions panel)
- **ESLint** — `dbaeumer.vscode-eslint`
- **Prettier** — `esbenp.prettier-vscode`
- **REST Client** — `humao.rest-client` (test your API without Postman)
- **SQL Server (mssql)** — `ms-mssql.mssql`

---

## 2. Project Folder Structure

After setup your project will look like this:

```
cads-bridge/
├── package.json                  ← root (runs both server+client concurrently)
├── .gitignore
│
├── server/                       ← Express + Socket.IO backend
│   ├── package.json
│   ├── .env                      ← ⚠️ YOUR DB CREDENTIALS GO HERE
│   ├── logs/                     ← auto-created on first run
│   ├── uploads/                  ← auto-created on first run
│   └── src/
│       ├── index.js              ← server entry point
│       ├── db/
│       │   ├── index.js          ← SQL connection pool
│       │   ├── migrate.js        ← creates all DB tables
│       │   └── seed.js           ← demo data + first admin accounts
│       ├── middleware/
│       │   ├── auth.js           ← JWT verify + role/team guards
│       │   ├── errorHandler.js
│       │   └── upload.js         ← Multer file handling
│       ├── routes/
│       │   ├── auth.js           ← /api/auth/*
│       │   ├── admin.js          ← /api/admin/*
│       │   ├── projects.js       ← /api/projects/*
│       │   ├── workspace.js      ← /api/projects/:id/messages|files
│       │   ├── tasks.js          ← /api/tasks/*
│       │   ├── kpi.js            ← /api/kpi/*
│       │   └── notifications.js  ← /api/notifications/*
│       └── utils/
│           ├── logger.js
│           ├── auditLog.js
│           └── notify.js
│
└── client/                       ← React frontend
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        ├── App.jsx               ← all routes
        ├── context/
        │   └── AuthContext.jsx   ← global user state + socket
        ├── services/
        │   └── api.js            ← all axios calls
        ├── components/
        │   ├── Sidebar.jsx
        │   ├── Topbar.jsx
        │   ├── DashboardLayout.jsx
        │   ├── NewProjectModal.jsx
        │   └── ProtectedRoute.jsx
        ├── pages/
        │   ├── Login.jsx
        │   ├── Register.jsx
        │   ├── Dashboard.jsx
        │   ├── KPI.jsx
        │   ├── Projects.jsx
        │   ├── Workspace.jsx
        │   ├── Tasks.jsx
        │   ├── AuditLogs.jsx
        │   ├── AdminUsers.jsx
        │   └── KpiSettings.jsx
        └── styles/
            ├── globals.css
            └── sidebar.css
```

---

## 3. Step-by-Step Setup

### Step 1 — Open the project in VS Code
```bash
# In VS Code: File → Open Folder → select cads-bridge/
# OR from terminal:
code cads-bridge
```

### Step 2 — Configure your database credentials
Open `server/.env` and update these lines:

```env
DB_SERVER=localhost          # or your SQL Server hostname
DB_PORT=1433
DB_NAME=cads_bridge
DB_USER=sa
DB_PASSWORD=YourStrong@Passw0rd   # ← CHANGE THIS to your actual SA password
DB_ENCRYPT=false
DB_TRUST_SERVER_CERT=true
```

> **Windows Auth instead of SA?** Change `DB_USER` and `DB_PASSWORD` to your Windows user,
> and set `DB_ENCRYPT=false`. Or use SQL Server Auth (recommended).

### Step 3 — Install all dependencies

Open VS Code Terminal (`Ctrl+`` ` ``  or View → Terminal) and run:

```bash
# From the root cads-bridge/ folder:

# Install root (concurrently)
npm install

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install

# Go back to root
cd ..
```

### Step 4 — Run database migrations (creates all tables)

```bash
cd server
npm run migrate
```

Expected output:
```
✅ SQL Server connected to localhost/cads_bridge
Running migration 1/15...
Running migration 2/15...
...
✅ All migrations completed successfully.
```

### Step 5 — Seed the database (creates demo accounts)

```bash
# Still in server/ folder:
npm run seed
```

Expected output:
```
╔══════════════════════════════════════════════╗
║       CADS-Bridge Seed Successful! 🚀        ║
╠══════════════════════════════════════════════╣
║  Demo Environment Code : CADS-XXXXXXXXXXXX   ║
╠══════════════════════════════════════════════╣
║  Platform Admin  : admin@cadsbridge.com      ║
║  CA Admin        : ca.admin@demo.com         ║
║  DS Admin        : ds.admin@demo.com         ║
║  Password (all)  : Admin@123                 ║
╚══════════════════════════════════════════════╝
```

**Save the Environment Code** — you'll need it to log in!

### Step 6 — Start the development servers

```bash
# From the root cads-bridge/ folder:
cd ..       # if you're still in server/
npm run dev
```

This starts both servers concurrently:
- **Backend:** `http://localhost:5000`
- **Frontend:** `http://localhost:3000`

VS Code terminal will show output from both in colour.

---

## 4. First Login

1. Open `http://localhost:3000`
2. Click **Sign In**
3. Enter:
   - **Environment Code:** (from seed output, e.g. `CADS-A1B2C3D4E5F6`)
   - **Email:** `ca.admin@demo.com`
   - **Password:** `Admin@123`
4. You'll land on the CA Admin dashboard

---

## 5. Running Servers Separately (if concurrently fails)

Open **two separate terminals** in VS Code:

**Terminal 1 — Backend:**
```bash
cd server
npm run dev
# Server running on port 5000
```

**Terminal 2 — Frontend:**
```bash
cd client
npm start
# React app running on port 3000
```

---

## 6. Common Issues & Fixes

### "Login failed: connect ECONNREFUSED 1433"
SQL Server is not running or the port is wrong.
```bash
# Check SQL Server is running (Windows):
services.msc → look for "SQL Server (MSSQLSERVER)" → Start it

# Docker: check container is up:
docker ps
docker start cads-sqlserver
```

### "Invalid environment code" on login
Run the seed again and copy the exact code:
```bash
cd server && npm run seed
```

### "Cannot find module 'mssql'"
Dependencies not installed:
```bash
cd server && npm install
```

### React blank page / "Module not found"
```bash
cd client && npm install
```

### Port 3000 or 5000 already in use
```bash
# Kill process on port (Windows):
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F

# Mac/Linux:
lsof -ti:5000 | xargs kill
```

### SQL Server SA login disabled (Windows)
Open SQL Server Management Studio (SSMS):
```
Server → Properties → Security → SQL Server and Windows Authentication mode
Then: Security → Logins → sa → Status → Login: Enabled
Restart SQL Server service
```

---

## 7. API Reference (quick test with REST Client)

Create a file `test.http` in the project root and paste:

```http
### Check env code
POST http://localhost:5000/api/auth/check-env
Content-Type: application/json

{ "envCode": "CADS-YOURENVCODEHERE" }

###
### Login as CA Admin
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "envCode": "CADS-YOURENVCODEHERE",
  "email": "ca.admin@demo.com",
  "password": "Admin@123"
}

###
### Health check
GET http://localhost:5000/api/health
```

Click **Send Request** above each block in VS Code (with REST Client extension).

---

## 8. Environment Variables Reference

| Variable               | Description                           | Default                    |
|------------------------|---------------------------------------|----------------------------|
| `PORT`                 | Express server port                   | `5000`                     |
| `DB_SERVER`            | SQL Server hostname                   | `localhost`                |
| `DB_PORT`              | SQL Server port                       | `1433`                     |
| `DB_NAME`              | Database name                         | `cads_bridge`              |
| `DB_USER`              | SQL login username                    | `sa`                       |
| `DB_PASSWORD`          | SQL login password                    | —                          |
| `DB_ENCRYPT`           | Encrypt connection (Azure = true)     | `false`                    |
| `DB_TRUST_SERVER_CERT` | Trust self-signed cert                | `true`                     |
| `JWT_SECRET`           | JWT signing secret                    | change before production   |
| `JWT_EXPIRES_IN`       | JWT expiry                            | `24h`                      |
| `UPLOAD_DIR`           | File upload directory                 | `uploads`                  |
| `MAX_FILE_SIZE_MB`     | Max upload size                       | `50`                       |
| `CLIENT_URL`           | Frontend URL for CORS                 | `http://localhost:3000`    |

---

## 9. Production Checklist (before deploying)

- [ ] Change `JWT_SECRET` to a 64-char random string
- [ ] Set `NODE_ENV=production`
- [ ] Set `DB_ENCRYPT=true` (required for Azure SQL)
- [ ] Use environment-injected secrets, not `.env` file
- [ ] Run `cd client && npm run build` and serve `/build` statically
- [ ] Enable HTTPS (TLS 1.2+)
- [ ] Set `DB_TRUST_SERVER_CERT=false` with a real cert
- [ ] Configure rate limiting for production traffic
- [ ] Set up SQL Server backups

---

## 10. Sprint 1 Feature Coverage

| User Story | Status | Where |
|------------|--------|-------|
| US-01: Registration & Environment Join | ✅ | `/register`, `POST /api/auth/register` |
| US-02: Role-Based Dashboard Access | ✅ | `/dashboard`, JWT + role guard |
| US-03: Admin Account Management | ✅ | `/admin/users`, `POST /api/admin/users/*` |
| US-04: KPI Command Centre | ✅ | `/kpi`, `GET /api/kpi` |
| US-05: Audit Trails & Task Management | ✅ | `/audit-logs`, `/tasks`, `audit_logs` table |
| US-06: Project Creation Workflow | ✅ | `NewProjectModal` 4-step wizard |
| US-07: Shared Collaborative Workspace | ✅ | `/projects/:id`, Socket.IO |
