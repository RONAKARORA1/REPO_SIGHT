# REPO-SIGHT
The tool performs tokenization, parsing, and metrics reporting across C++, Python, and Java source files. The long-term vision includes a website, deployment, and monetization (freemium model targeting individual developers, students, and job-seekers as the resolved primary thesis).


# REPO‑SIGHT SaaS Platform

A production‑ready SaaS wrapper for the **REPO‑SIGHT/CMA** static‑code‑analysis engine, deployed on **Vercel**.

## 📋 Overview

- **Frontend**: Your existing dashboard (`index.html`, `dashboard.html`, `pricing.html`, `docs.html`, etc.) served as a static site.
- **Backend API**: Node.js/TypeScript Serverless & Background Functions (auth, projects, scans, uploads, health).
- **Analysis Engine**: The unmodified C++ REPO‑SIGHT/CMA binary (`backend/bin/linux-x64-cma`) compiled for Linux x86_64 and executed inside a Vercel Background Function (max 15 minutes).
- **Data Stores**:
  - **Vercel Postgres** – users, projects, scans, blob IDs.
  - **Vercel Blob** – uploaded source ZIPs, generated JSON/HTML reports.
  - **Vercel KV** – (optional) used for rate‑limiting or caching; not required for basic operation.

## 🚀 Quick Start (Local Development)

> req**

### Prerequisites**
   - A Vercel account** free
   - **Vercel CLI**: `npm i -g vercel`
   - Git (to push your repo)
   - Node.js ≥ 18 (for local testing; Vercel uses its own runtime)

2. ### 2. Fork / Clone this repository
   ```bash
   git clone https://github.com/yourusername/repo-sight-vercel.git
   cd repo-sight-vercel
