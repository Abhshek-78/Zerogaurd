# 🛡️ ZeroGuard: Distributed In-Line API Security Proxy & Cryptographic Audit System

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=node.js)
![Fastify](https://img.shields.io/badge/Fastify-4.x-black?style=for-the-badge&logo=fastify)
![Redis](https://img.shields.io/badge/Redis-7.0-red?style=for-the-badge&logo=redis)
![MongoDB](https://img.shields.io/badge/MongoDB-7.0-green?style=for-the-badge&logo=mongodb)
![React](https://img.shields.io/badge/React-18-blue?style=for-the-badge&logo=react)
![Vite](https://img.shields.io/badge/Vite-5.x-purple?style=for-the-badge&logo=vite)
![Docker](https://img.shields.io/badge/Docker-Enabled-blue?style=for-the-badge&logo=docker)
![License](https://img.shields.io/badge/License-MIT-brightgreen?style=for-the-badge)

**ZeroGuard** is a high-performance, autonomous API security reverse proxy designed to protect microservices from Denial-of-Service (DDoS) traffic spikes, web injection attacks (SQLi, XSS, Path Traversal), and unauthorized log tampering.

It executes distributed rate-limiting and payload sanitization in **$<3\text{ ms}$** on the critical request path, while asynchronously offloading tamper-evident audit logs to a **SHA-256 Merkle-tree hash-chained database ledger**.

---

## 🌟 Key Features

* **⚡ Ultra-Low Latency In-Line Reverse Proxy:** Built with Fastify and zero-copy stream piping to intercept and forward HTTP traffic with minimal overhead ($<3\text{ ms}$ p95).
* **🔒 Atomic Distributed Rate-Limiting:** Implements a sliding-window counter in **Redis via Lua scripts**, eliminating check-then-act race conditions across concurrent application instances.
* **🛡️ Pre-Compiled Signature Sanitizer:** Inspects query parameters and JSON payloads for SQL Injection (SQLi), Cross-Site Scripting (XSS), and Local File Inclusion (LFI) patterns.
* **🚨 Autonomous IP Auto-Jailing Engine:** Dynamically calculates client violation scores. IPs exceeding threat thresholds are blacklisted in Redis memory for automatic isolation.
* **⚡ Asynchronous Queue Offloading:** Offloads audit logging from the critical request path using **BullMQ & Redis Streams**, ensuring non-blocking proxy throughput.
* **⛓️ SHA-256 Cryptographic Audit Ledger:** Stores immutable event logs in MongoDB using block-chaining ($\text{SHA-256}(\text{payload} + \text{previousHash})$), complete with an automated integrity scanner to detect unauthorized record tampering.
* **📊 OpenTelemetry & Live Telemetry Console:** Exposes native Prometheus `/metrics` endpoints integrated with a live React + Tailwind CSS operational dashboard.

---

## 📐 System Architecture

```text
                                 ┌─────────────────────────┐
                                 │   Client / Frontend     │
                                 └────────────┬────────────┘
                                              │ HTTP Request
                                              ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│  TIER 1: IN-LINE GATEWAY (Fastify / Node.js Proxy)                                        │
│                                                                                           │
│  1. IP Extract  ─►  2. Redis Lua Limiter  ─►  3. Pre-Compiled Regex  ─►  4. Auto-Jailer   │
│                        (Atomic ZSET)             (SQLi / XSS Check)       (Active Ban)    │
└──────────┬────────────────────────────────────────────────────────┬───────────────────────┘
           │                                                        │
           │ (Fast Socket Pipe)                                     │ (Async Fire-and-Forget)
           ▼                                                        ▼
┌──────────────────────┐                                 ┌──────────────────────────┐
│  Downstream Service  │                                 │ TIER 2: QUEUE BUFFER     │
│   (Target API / DB)  │                                 │ (BullMQ / Redis Streams) │
└──────────────────────┘                                 └──────────┬───────────────┘
                                                                    │
                                                                    ▼
                                                         ┌──────────────────────────┐
                                                         │ TIER 3: WORKER PROCESS   │
                                                         │ (Node.js Background Job) │
                                                         └──────────┬───────────────┘
                                                                    │
                                                                    ▼
                                                         ┌──────────────────────────┐
                                                         │ MongoDB Cryptographic    │
                                                         │ Ledger (SHA-256 Chain)   │
                                                         └──────────────────────────┘


🚀 Getting Started
Prerequisites
Node.js v18+

Docker & Docker Desktop

Git

1. Clone the Repository
git clone [https://github.com/your-username/zeroguard.git](https://github.com/your-username/zeroguard.git)
cd zeroguard

2. Start Infrastructure Containers
Boot up Redis and MongoDB containers via Docker Compose:
docker compose up -d
Verify containers are running using docker ps.

3. Install Dependencies & Start Services
Step 3.1: Start Mock Upstream Server
cd mock-upstream
npm install
node index.js

Step 3.2: Start ZeroGuard Proxy Gateway
Open a new terminal window:
cd gateway
npm install
node src/server.js
Step 3.3: Start Background Audit Worker
Open a new terminal window:
cd worker
npm install
node src/consumer.js

Step 3.4: Start Live Telemetry Dashboard
Open a new terminal window:
cd dashboard
npm install
npm run dev




📊 Prometheus Telemetry
ZeroGuard exposes OpenMetrics natively on http://localhost:8000/metrics:

Plaintext
# HELP zeroguard_http_requests_total Total number of HTTP requests processed
# TYPE zeroguard_http_requests_total counter
zeroguard_http_requests_total{method="GET",status_code="200",action="PASSED"} 42
zeroguard_http_requests_total{method="GET",status_code="429",action="BLOCKED_RATE_LIMIT"} 6
zeroguard_http_requests_total{method="GET",status_code="403",action="BLOCKED_THREAT"} 3

# HELP zeroguard_http_request_duration_ms HTTP request latency overhead in milliseconds
# TYPE zeroguard_http_request_duration_ms histogram
zeroguard_http_request_duration_ms_bucket{le="1"} 38
zeroguard_http_request_duration_ms_bucket{le="2.5"} 48
zeroguard_http_request_duration_ms_bucket{le="+Inf"} 51
