# ORVA Store — Pre-Implementation Architecture Audit & Modernization Report

**Target Production Application:** [https://orva-store.com/admin](https://orva-store.com/admin)  
**Target UI Library Location:** [`orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main)  
**Audit Type:** Comprehensive Read-Only System Audit & Architecture Assessment  
**Audit Date:** October 2026  
**Auditor:** Senior Software Architect & Full-Stack Engineering Auditor  

---

## Table of Contents
1. [A. Executive Summary](#a-executive-summary)
2. [B. Verified Technology Stack](#b-verified-technology-stack)
3. [C. Repository and Route Map](#c-repository-and-route-map)
4. [D. Current Order Lifecycle and Data Flow](#d-current-order-lifecycle-and-data-flow)
5. [E. Supabase Schema Evidence and Unknowns](#e-supabase-schema-evidence-and-unknowns)
6. [F. UI Library Compatibility Assessment](#f-ui-library-compatibility-assessment)
7. [G. Recommended Integration Architecture](#g-recommended-integration-architecture)
8. [H. Proposed Order-Switch Data Model and Workflow](#h-proposed-order-switch-data-model-and-workflow)
9. [I. Security, Migration, and Regression Risks](#i-security-migration-and-regression-risks)
10. [J. Questions Requiring Product-Owner Decisions](#j-questions-requiring-product-owner-decisions)
11. [K. Proposed Implementation Phases with Dependencies and Acceptance Criteria](#k-proposed-implementation-phases-with-dependencies-and-acceptance-criteria)

---

## A. Executive Summary

This architecture audit evaluated the complete codebase of **ORVA Store** across both its production environment on Hostinger and its local/Vercel development configurations, and conducted an in-depth evaluation of the target dashboard template located in `orvastore Dashbaord v0.9/next-shadcn-admin-dashboard-baseui-main`.

### Key Verified Findings:
1. **Dual Architecture Divergence:** The live production environment at `orva-store.com/admin` runs on **Hostinger LiteSpeed + PHP 8.3** via [`.htaccess`](file:///e:/Websites%20On%20Line/yamahasac/.htaccess) rewrites to [`api/delivery.php`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.php) and [`api/send-order.php`](file:///e:/Websites%20On%20Line/yamahasac/api/send-order.php). Simultaneously, the repository maintains a **Node.js/Vercel serverless environment** ([`dev-server.js`](file:///e:/Websites%20On%20Line/yamahasac/dev-server.js), [`api/delivery.js`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js), [`lib/db.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/db.js)). Critical courier integration logic (e.g. direct Redex dispatch and PDF label streaming) is implemented in Node.js but missing in the PHP version.
2. **Current Admin Implementation:** The existing admin panel is a single-page **Vanilla HTML5/CSS/JavaScript** application ([`admin.html`](file:///e:/Websites%20On%20Line/yamahasac/admin.html), [`admin.js`](file:///e:/Websites%20On%20Line/yamahasac/admin.js), [`admin.css`](file:///e:/Websites%20On%20Line/yamahasac/admin.css)) with custom canvas charts, bilingual support (FR/AR with RTL), and client-driven polling (every 20s).
3. **Critical Security Vulnerabilities Identified:**
   - **Row-Level Security (RLS) Permissiveness:** [`scripts/apply-policies.js`](file:///e:/Websites%20On%20Line/yamahasac/scripts/apply-policies.js) executed `GRANT UPDATE, DELETE ON public.orders TO anon, authenticated;` with policies allowing unauthenticated `anon` clients to `SELECT`, `INSERT`, `UPDATE`, and `DELETE` all orders without restriction.
   - **Endpoint Authorization Bypass:** While [`api/auth.js`](file:///e:/Websites%20On%20Line/yamahasac/api/auth.js) checks an admin password, [`api/orders.js`](file:///e:/Websites%20On%20Line/yamahasac/api/orders.js), [`api/delivery.js`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js), and [`api/delivery.php`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.php) enforce **no authentication headers or session validation**, allowing direct public querying and deletion of orders.
4. **Target UI Library Profile:** The target directory contains a modern **Next.js 16 (React 19) + Tailwind CSS v4 + Base UI + TanStack Table v9** SaaS template (`studio-admin`). Migrating to this template is a high-value modernization, but requires addressing hosting constraints (Hostinger PHP shared hosting cannot execute Next.js SSR) and adding RTL/Arabic support, Algerian 58-Wilaya data pipelines, and a secure Supabase backend interface.
5. **Order-Switch Workflow Gap:** Currently, the system lacks any native order-switch, exchange, or parent-child order tracking mechanism. Order mutations overwrite records in place, destroying original conversion history.

---

## B. Verified Technology Stack

### 1. Existing Production & Storefront Application

| Component | Verified Technology | Reference / Configuration |
| :--- | :--- | :--- |
| **Storefront & Admin Core** | Native HTML5, ES6+ Vanilla JS, Vanilla CSS3 | [`index.html`](file:///e:/Websites%20On%20Line/yamahasac/index.html), [`admin.html`](file:///e:/Websites%20On%20Line/yamahasac/admin.html), [`admin.js`](file:///e:/Websites%20On%20Line/yamahasac/admin.js) |
| **Typography & Icons** | Google Fonts (Cairo, Plus Jakarta Sans, JetBrains Mono), FontAwesome 6 Pro CDN | [`admin.html#L11-L18`](file:///e:/Websites%20On%20Line/yamahasac/admin.html#L11-L18) |
| **Charts** | HTML5 Canvas 2D manual path drawing (no external chart library in `admin.js`) | [`admin.js#L900-L1028`](file:///e:/Websites%20On%20Line/yamahasac/admin.js#L900-L1028) |
| **Production Runtime (Hostinger)** | LiteSpeed Web Server, PHP 8.3 | [`.htaccess`](file:///e:/Websites%20On%20Line/yamahasac/.htaccess), [`api/config.php`](file:///e:/Websites%20On%20Line/yamahasac/api/config.php) |
| **Development / Vercel Runtime** | Node.js (CommonJS, `package.json` v1.0.0), Vercel Serverless | [`package.json`](file:///e:/Websites%20On%20Line/yamahasac/package.json), [`dev-server.js`](file:///e:/Websites%20On%20Line/yamahasac/dev-server.js), [`vercel.json`](file:///e:/Websites%20On%20Line/yamahasac/vercel.json) |
| **Database & ORM** | Supabase PostgreSQL 15, PostgREST REST API, direct `pg` connection pool fallback | [`supabase/schema.sql`](file:///e:/Websites%20On%20Line/yamahasac/supabase/schema.sql), [`lib/db.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/db.js), [`lib/supabaseServer.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/supabaseServer.js) |
| **Node.js Dependencies** | `@supabase/supabase-js` (^2.117.2), `@supabase/ssr` (^0.12.7), `pg` (^8.23.1), `dzship` (^1.0.0), `xlsx` (^0.18.5), `googleapis` (^176.0.0), `resend` (^3.2.0) | [`package.json#L11-L22`](file:///e:/Websites%20On%20Line/yamahasac/package.json#L11-L22) |
| **Carrier Integrations** | Direct REST to Redex EcoTrack (`redex.ecotrack.dz`), fallback via `dzship` (Yalidine, ZR Express) | [`api/delivery.js#L15-L215`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L15-L215), [`lib/communesMapper.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/communesMapper.js) |

### 2. Target UI Library (`next-shadcn-admin-dashboard-baseui-main`)

| Layer | Technology & Exact Version | Source File |
| :--- | :--- | :--- |
| **Framework** | Next.js `^16.3.2` (App Router) | [`package.json#L37`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L37) |
| **Language & Runtime** | TypeScript `^5.9.3`, React `^19.2.8`, React DOM `^19.2.8` | [`package.json#L38-L40`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L38-L40), [`#L67`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L67) |
| **Component Primitives** | `@base-ui/react` `^1.7.0` (MUI unstyled Base UI), `@shadcn/react` `^0.3.0`, `shadcn` `^4.19.0` | [`package.json#L20`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L20), [`#L26`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L26), [`#L44`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L44) |
| **CSS & Design Tokens** | Tailwind CSS `^4.1.5`, `@tailwindcss/postcss` `^4.3.3`, `tailwind-merge` `^3.6.0`, `cva` `^0.7.1` | [`package.json#L28`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L28), [`#L46`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L46), [`globals.css#L1-L54`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/globals.css#L1-L54) |
| **Data Tables / Grids** | `@tanstack/react-table` `^9.1.2` (TanStack Table v9 Atom-based reactivity) | [`package.json#L27`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L27), [`recent-orders.tsx#L5`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/%28main%29/dashboard/ecommerce/_components/recent-orders.tsx#L5) |
| **Forms & Validation** | `react-hook-form` `^7.85.0`, `@hookform/resolvers` `^5.9.1`, `zod` `^4.4.3` | [`package.json#L25`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L25), [`#L41`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L41), [`#L49`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L49) |
| **State Management** | `zustand` `^5.0.15` | [`package.json#L50`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L50) |
| **Charts** | `recharts` `^3.8.0` | [`package.json#L43`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L43) |
| **Icons** | `lucide-react` `^1.33.0`, `simple-icons` `^16.28.0` | [`package.json#L36`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L36), [`#L45`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L45) |
| **Tooling & Linter** | Biome `^2.5.10` (no ESLint/Prettier), React Compiler Babel Plugin | [`biome.json`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/biome.json), [`package.json#L9-L12`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/package.json#L9-L12) |

---

## C. Repository and Route Map

### 1. Repository Structure Overview
```
yamahasac/
├── admin.html               # Main Admin Dashboard Viewport & Modals
├── admin.js                 # Admin client logic (1865 lines, state, API calls, charts)
├── admin.css                # Admin CSS stylesheet
├── algeria-communes.js      # 58 Wilayas & Communes client dictionary
├── index.html               # Storefront Landing Page
├── pack1.html               # Landing Page Pack 1 (4,950 DZD)
├── pack2.html               # Landing Page Pack 2 (13,390 DZD)
├── dev-server.js            # Node HTTP server for local emulation
├── vercel.json              # Vercel Serverless routing configuration
├── .htaccess                # Hostinger Apache/LiteSpeed rules & PHP routing
│
├── api/                     # Backend API handlers (Dual Stack)
│   ├── auth.js / auth.php
│   ├── delivery.js / delivery.php
│   ├── orders.js
│   ├── risk.js
│   ├── send-order.js / send-order.php
│   └── config.php           # Hostinger PHP credentials config
│
├── lib/                     # Server-side Business & Integration Libraries
│   ├── db.js                # Supabase REST + PG Pool + Excel abstraction
│   ├── supabaseServer.js    # Supabase Client & PG Pool initialization
│   ├── communesMapper.js    # Algeria commune name resolver for EcoTrack
│   ├── riskEngine.js        # Fraud & risk evaluation engine
│   └── metaCAPI.js          # Meta Conversions API client
│
├── supabase/
│   ├── schema.sql           # PostgreSQL table schemas, indexes, triggers, RLS
│   └── config.toml          # Supabase CLI project configuration
│
└── orvastore Dashbaord v0.9/
    └── next-shadcn-admin-dashboard-baseui-main/  # Target Next.js 16 UI Dashboard
        ├── src/app/(main)/dashboard/ecommerce/   # Target Ecommerce view & table
        ├── src/app/(main)/dashboard/logistics/   # Target Logistics & Shipment views
        └── src/components/ui/                    # 61 Shadcn / Base UI components
```

### 2. Route Map & Endpoint Specifications

| Public URL Route | Hostinger Handler | Local / Vercel Handler | Method | Purpose & Payload |
| :--- | :--- | :--- | :--- | :--- |
| `/admin` or `/admin.html` | Rewritten to `admin.html` | Served static | `GET` | Admin single-page interface |
| `/api/auth` | [`api/auth.php`](file:///e:/Websites%20On%20Line/yamahasac/api/auth.php) | [`api/auth.js`](file:///e:/Websites%20On%20Line/yamahasac/api/auth.js) | `POST` | Admin password validation; returns static session token |
| `/api/send-order` | [`api/send-order.php`](file:///e:/Websites%20On%20Line/yamahasac/api/send-order.php) | [`api/send-order.js`](file:///e:/Websites%20On%20Line/yamahasac/api/send-order.js) | `POST` | Public checkout order intake, anti-bot, DB insertion, CAPI, Telegram |
| `/api/delivery?action=get_all_orders` | [`api/delivery.php#L139`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.php#L139) | [`api/delivery.js#L374`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L374) | `GET` | Fetches all active orders from Supabase (normalized JSON) |
| `/api/delivery?action=update_status` | [`api/delivery.php#L42`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.php#L42) | [`api/delivery.js#L417`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L417) | `POST` | Updates order `status` in Supabase |
| `/api/delivery?action=create` | *Missing in PHP* | [`api/delivery.js#L527`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L527) | `POST` | Dispatches parcel directly to Redex EcoTrack API; updates DB with tracking code |
| `/api/delivery?action=label_pdf` | *Missing in PHP* | [`api/delivery.js#L630`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L630) | `GET` | Streams thermal/A4 official carrier PDF label from Redex API |
| `/api/delivery?action=track` | *Missing in PHP* | [`api/delivery.js#L678`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L678) | `GET` | Queries live tracking steps from EcoTrack |
| `/api/delivery?action=delete` | [`api/delivery.php#L83`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.php#L83) | [`api/delivery.js#L715`](file:///e:/Websites%20On%20Line/yamahasac/api/delivery.js#L715) | `POST`/`DELETE` | Removes order from database or marks `status = 'deleted'` |
| `/api/orders` | *Not routed in .htaccess* | [`api/orders.js`](file:///e:/Websites%20On%20Line/yamahasac/api/orders.js) | `GET`, `POST`, `PUT`, `DELETE` | Full CRUD interface over [`lib/db.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/db.js) (unauthenticated) |
| `/api/risk` | *Not implemented in PHP* | [`api/risk.js`](file:///e:/Websites%20On%20Line/yamahasac/api/risk.js) | `GET`, `POST` | Admin risk override & customer trust watchlist management |

---

## D. Current Order Lifecycle and Data Flow

```
+-----------------------------------------------------------------------+
| 1. Storefront Checkout (Customer on pack1.html / pack2.html)          |
|    - Customer submits Full Name, Phone, Wilaya, Commune               |
+-----------------------------------------------------------------------+
                                   │
                                   ▼ POST /api/send-order
+-----------------------------------------------------------------------+
| 2. Order Intake & Security Pipeline (api/send-order.js or .php)       |
|    - Anti-bot / Honeypot verification                                 |
|    - Rate limiting check (2 attempts per 24 hours per phone/IP)       |
|    - Risk Engine Evaluation (score 0-100, assigns LOW/MED/HIGH)       |
|    - Record persisted into Supabase public.orders (status: pending)   |
|    - Trigger instant Telegram notification to operations channel      |
|    - Trigger Meta CAPI Server Purchase Event                          |
+-----------------------------------------------------------------------+
                                   │
                                   ▼ Periodic Client Polling (20s)
+-----------------------------------------------------------------------+
| 3. Admin Confirmation Call (admin.html + admin.js)                    |
|    - Operator views unconfirmed orders in pending tab                 |
|    - Operator calls customer directly via tel: or WhatsApp link       |
|    - Customer confirms, cancels, or requests order alteration         |
|    - Status updated to 'confirmed' or 'cancelled' via update_status   |
+-----------------------------------------------------------------------+
                                   │
                                   ▼ Dispatch Trigger ("Expédier ⚡")
+-----------------------------------------------------------------------+
| 4. Logistics & Carrier Dispatch (api/delivery.js create)              |
|    - Pre-fill modal with order details                                |
|    - Commune normalized using lib/communesMapper.js                   |
|    - HTTP POST to https://redex.ecotrack.dz/api/v1/create/order       |
|    - EcoTrack returns official tracking code (ECEOSK...)              |
|    - Order updated: in_redex=true, status='shipped', tracking_code   |
|    - Operator fetches thermal shipping PDF label via action=label_pdf |
+-----------------------------------------------------------------------+
```

### Order Identifier and Status Domain
- **Order Identifiers:** `ORVA-XXXXX` (e.g. `ORVA-49502`, generated via `rand(10000, 99999)`).
- **Tracking Identifiers:** EcoTrack carrier standard, prefixed by `ECEOSK...` or courier tracking standard.
- **Statuses Supported:**
  - `pending` (⏳ En attente / قيد الانتظار)
  - `confirmed` (📞 Confirmée / مؤكدة)
  - `shipped` (🚚 Expédiée / تم الشحن)
  - `delivered` (✅ Livrée / تم التسليم)
  - `returned` (⚠️ Retournée / مرتجع)
  - `cancelled` (❌ Annulée / ملغاة)
  - `deleted` (Archived / Soft-deleted)

---

## E. Supabase Schema Evidence and Unknowns

### 1. Verified Schema Evidence from [`supabase/schema.sql`](file:///e:/Websites%20On%20Line/yamahasac/supabase/schema.sql)

```sql
-- Core Table: public.orders
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'orvastore',
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    wilaya TEXT NOT NULL,
    commune TEXT DEFAULT 'الجزائر',
    delivery_type TEXT DEFAULT 'توصيل للمنزل',
    delivery_time TEXT DEFAULT '24 - 48 H',
    quantity INTEGER DEFAULT 1,
    product_name TEXT DEFAULT 'Pack 1 Pro',
    product_total TEXT DEFAULT '4950 د.ج',
    shipping_fee TEXT DEFAULT '500 د.ج',
    price_num NUMERIC DEFAULT 4950,
    grand_total TEXT DEFAULT '5450 د.ج',
    status TEXT DEFAULT 'pending',
    in_redex BOOLEAN DEFAULT false,
    redex_tracking_code TEXT,
    notes TEXT,
    remarks JSONB DEFAULT '[]'::jsonb,
    client_ip TEXT,
    client_ip_hash TEXT,
    device_id TEXT,
    risk_score INTEGER DEFAULT 0,
    risk_level TEXT DEFAULT 'LOW',
    risk_decision TEXT DEFAULT 'ALLOW',
    risk_reasons TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

#### Supporting Tables in Schema:
- **`public.order_items`**: `id UUID PRIMARY KEY`, `order_id TEXT REFERENCES public.orders(order_id) ON DELETE CASCADE`, `product_name`, `quantity`, `unit_price`, `total_price`, `created_at`.
- **`public.rate_limits`**: `id UUID PRIMARY KEY`, `ip TEXT`, `device_id TEXT`, `phone TEXT`, `created_at TIMESTAMPTZ`.
- **`public.customers`**: `id UUID PRIMARY KEY`, `customer_id TEXT UNIQUE`, `phone TEXT UNIQUE`, `name`, `total_orders`, `completed`, `cancelled`, `rejected`, `trust_score`, `risk_level`.
- **`public.watchlist`**: `id UUID PRIMARY KEY`, `identifier TEXT`, `identifier_type TEXT`, `reason TEXT`, `status TEXT`, `expires_at TIMESTAMPTZ`.
- **`public.risk_events`**: `id UUID PRIMARY KEY`, `event_id TEXT UNIQUE`, `event_type TEXT`, `store_id TEXT`, `order_id TEXT`, `actor_phone TEXT`, `metadata JSONB`.

### 2. Unknowns Requiring Separate Authorized Inspection
- **Live Database Drift:** Because this audit was strictly read-only on local repository files, any manual DDL, additional columns, or custom functions executed directly in Supabase Cloud Studio (`olmsjkhdfghyydogcvvy.supabase.co`) cannot be verified without active cloud project read credentials.
- **Active Extensions:** Postgres extensions `uuid-ossp` and `pgcrypto` are requested in `schema.sql`, but active server installation must be confirmed on the live database.

---

## F. UI Library Compatibility Assessment

### 1. Structural Comparison: Existing Admin vs. Target Template

| Dimension | Existing Admin (`admin.html` + `admin.js`) | Target UI Library (`studio-admin`) | Compatibility & Assessment |
| :--- | :--- | :--- | :--- |
| **Framework** | Vanilla HTML5 / No framework | Next.js 16.3.2 (App Router, Server Components) | **Major architectural shift**; requires Node runtime or export strategy. |
| **UI Components** | Custom raw HTML/CSS classes (`admin.css`, 51KB) | 61 modular components built with `@base-ui/react` + `shadcn` | High upgrade in polish, consistency, and reusability. |
| **Styling Engine** | Vanilla CSS with custom CSS variables | Tailwind CSS v4 (`@import "tailwindcss"`) | High visual appeal; requires migrating custom color palettes to `@theme`. |
| **Data Grid** | Native HTML `<table>` manipulated via innerHTML string templates | `@tanstack/react-table` v9 (`useTable`, atoms, typed column definitions) | Massive improvement in filtering, sorting, pagination, and multi-selection. |
| **Forms** | Native `<form>` with DOM `document.getElementById` extraction | `react-hook-form` + `zod` validation schemas | Robust type-safe validation; easily accommodates new order-switch fields. |
| **Localization & RTL** | 100% Bilingual FR/AR with dynamic RTL (`dir="rtl"`, Cairo font) | English only, LTR layout | **Requires adding RTL support** via `components/ui/direction.tsx` and Cairo font integration. |
| **Algerian Logistics Features** | Wilaya/Commune selectors, stop desk logic, thermal label preview | Generic SaaS / US Ecommerce demo tables | Domain logic (`algeria-communes.js`, tariffs) must be imported into React hooks. |

### 2. Components That Can Be Immediately Reused
- **`Table` & Data Grid:** [`src/app/(main)/dashboard/ecommerce/_components/recent-orders.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/%28main%29/dashboard/ecommerce/_components/recent-orders.tsx) and [`columns.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/%28main%29/dashboard/ecommerce/_components/recent-orders-table/columns.tsx) provide an immediate foundation for the Algerian order list.
- **`Dialog` & `Drawer`:** [`src/components/ui/dialog.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/components/ui/dialog.tsx) and [`drawer.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/components/ui/drawer.tsx) replace the existing manual modal backdrop system for parcel creation, order details, and the order-switch modal.
- **`KPI Strip` / Metrics:** [`src/app/(main)/dashboard/ecommerce/_components/kpi-strip.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/app/%28main%29/dashboard/ecommerce/_components/kpi-strip.tsx) directly maps to ORVA's Total Orders, Revenue (COD), Pending, Shipped, and Return rates.
- **`DirectionProvider`:** [`src/components/ui/direction.tsx`](file:///e:/Websites%20On%20Line/yamahasac/orvastore%20Dashbaord%20v0.9/next-shadcn-admin-dashboard-baseui-main/src/components/ui/direction.tsx) exists to support bidirectional LTR/RTL switching.

### 3. Dependencies & Integration Friction
- **Next.js 16 + React 19:** React 19 does not allow certain legacy React patterns. Legacy packages like `dzship` are CommonJS and must run strictly in Node.js server actions or route handlers, not in React client bundles.
- **Hostinger Shared Hosting Limitation:** Hostinger's standard cPanel / hPanel web hosting executes Apache/LiteSpeed with PHP. It **cannot run a long-running Node/Next.js 16 SSR server**. Deploying this Next.js app requires either hosting the Next.js app on **Vercel** (e.g. `admin.orva-store.com`) connected to the Supabase database, or building with Next.js static export (`output: 'export'`), which loses Server Actions and Server Components.

---

## G. Recommended Integration Architecture

The least disruptive, highest stability architecture separates the customer-facing storefront from the new admin dashboard:

```
[Customer Traffic]
       │
       ▼
[Hostinger LiteSpeed / CDN]  ─── Storefront Pages (pack1.html, pack2.html)
       │                         (Fast, static, zero downtime)
       │ POST /api/send-order
       ▼
[Supabase PostgreSQL 15] ◄────────────────────────────────────────┐
 (Single Source of Truth)                                         │
       ▲                                                          │
       │ Server Actions / Route Handlers (@supabase/ssr)          │
       ▼                                                          │
[Next.js 16 Admin Dashboard]                                     │
 (next-shadcn-admin-dashboard-baseui-main)                       │
 - Deployed on Vercel at `admin.orva-store.com`                   │
 - Secured with Supabase Auth / Scoped Role                      │
 - Direct EcoTrack Carrier API integration                        │
 - Implements Order-Switch Modal & Audit Trail ───────────────────┘
```

---

## H. Proposed Order-Switch Data Model and Workflow

### 1. Database Schema Extension for Order Switching

```sql
-- 1. Create Order Switch Audit Trail Table
CREATE TABLE IF NOT EXISTS public.order_switches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_order_id TEXT NOT NULL REFERENCES public.orders(order_id) ON DELETE RESTRICT,
    new_order_id TEXT NOT NULL REFERENCES public.orders(order_id) ON DELETE RESTRICT,
    switch_type TEXT NOT NULL DEFAULT 'PACK_CHANGE', -- 'PACK_CHANGE', 'QUANTITY_CHANGE', 'UPGRADE', 'DOWNGRADE'
    from_product TEXT NOT NULL,
    to_product TEXT NOT NULL,
    from_amount NUMERIC NOT NULL,
    to_amount NUMERIC NOT NULL,
    price_difference NUMERIC GENERATED ALWAYS AS (to_amount - from_amount) STORED,
    reason TEXT NOT NULL,
    operator_name TEXT NOT NULL DEFAULT 'Admin',
    carrier_notified BOOLEAN DEFAULT false,
    transfer_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add Linkage and State Columns to public.orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS parent_order_id TEXT REFERENCES public.orders(order_id),
ADD COLUMN IF NOT EXISTS switched_to_order_id TEXT REFERENCES public.orders(order_id),
ADD COLUMN IF NOT EXISTS switch_status TEXT DEFAULT 'none', -- 'none', 'switched_out', 'switched_in'
ADD COLUMN IF NOT EXISTS transfer_comment TEXT;

-- 3. Create Performance Indexes for Traversal
CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON public.orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_switched_to_order_id ON public.orders(switched_to_order_id);
CREATE INDEX IF NOT EXISTS idx_order_switches_orig ON public.order_switches(original_order_id);
CREATE INDEX IF NOT EXISTS idx_order_switches_new ON public.order_switches(new_order_id);
```

### 2. Copy-Ready EcoTrack / Redex Transfer Comment Generator

When an order is switched, the system automatically generates an exact, formatted transfer comment suitable for pasting into the EcoTrack portal or sending to delivery drivers:

```text
[ORVA STORE — DEMANDE DE MODIFICATION / ÉCHANGE]
─────────────────────────────────────────────
• N° Commande Initiale : {ORIGINAL_ORDER_ID} ({ORIGINAL_PRODUCT} — {ORIGINAL_AMOUNT} DZD)
• N° Nouvelle Commande  : {NEW_ORDER_ID} ({NEW_PRODUCT} — {NEW_AMOUNT} DZD)
• Code Suivi Transporteur : {TRACKING_CODE_OR_NONE}
• Client : {CUSTOMER_NAME} ({CUSTOMER_PHONE})
• Destination : {WILAYA} — {COMMUNE} ({DELIVERY_TYPE})
• Motif de Modification : {SWITCH_REASON}
• MONTANT COD FINAL À ENCAISSER : {NEW_AMOUNT} DZD
─────────────────────────────────────────────
Instruction : Prière de livrer le nouveau pack et d'encaisser le montant actualisé. Accord client confirmé par téléphone.
```

### 3. Step-by-Step Order-Switch Execution Logic
1. Operator clicks **"Switch / Modifier Commande"** on Order A.
2. The UI checks if Order A has already been switched (`switch_status === 'switched_out'`). If already switched, the button is disabled and links to the active child order.
3. Operator selects the new package (e.g. Pack 2 @ 13,390 DZD), enters the customer's stated reason, and confirms.
4. An atomic database operation:
   - Preserves Order A with `status = 'switched'`, `switch_status = 'switched_out'`, `switched_to_order_id = 'ORVA-B'`.
   - Creates Order B with identical customer address and contact data, `parent_order_id = 'ORVA-A'`, `status = 'confirmed'`.
   - Writes an immutable record to `public.order_switches`.
5. The UI generates and displays the copy-ready EcoTrack transfer comment with a 1-click clipboard button.
6. The courier operation remains decoupled: if the package was already in transit with Redex, the operator notifies the carrier manually, preventing automated courier desynchronization.

---

## I. Security, Migration, and Regression Risks

### 1. Critical Security Findings

```
[RISK-SEC-01] CRITICAL: RLS Full Access Granted to Anon Role
File: scripts/apply-policies.js (Lines 17-36)
Evidence:
  CREATE POLICY "Allow anon order update" ON public.orders FOR UPDATE TO anon, authenticated USING (true);
  CREATE POLICY "Allow anon order delete" ON public.orders FOR DELETE TO anon, authenticated USING (true);
  GRANT UPDATE, DELETE ON public.orders TO anon, authenticated;
Impact: Any malicious actor inspecting browser network traffic can take the Supabase Publishable/Anon key
and issue direct REST requests to delete all orders or extract customer PII.
Mitigation: Immediately revoke anon UPDATE and DELETE grants; enforce service_role or authenticated sessions.

[RISK-SEC-02] HIGH: Unauthenticated API Endpoints in Application Layer
Files: api/orders.js, api/delivery.js, api/delivery.php
Evidence: Endpoints handle GET, POST, and DELETE requests without inspecting Authorization headers or sessions.
Impact: Orders can be listed and destroyed via direct cURL/fetch without logging into the admin portal.
Mitigation: Enforce JWT / Bearer token validation matching process.env.ADMIN_API_TOKEN on all API routes.

[RISK-SEC-03] HIGH: Cleartext Credentials Committed in Codebase
Files: scripts/apply-policies.js, api/config.php
Evidence: Direct Postgres connection string with password in scripts/apply-policies.js;
Supabase keys and Telegram Bot tokens hardcoded in api/config.php.
Impact: Exposure of source code completely compromises database and alert pipelines.
Mitigation: Remove hardcoded credentials, rotate the Supabase database password immediately,
and migrate strictly to environment variables.
```

### 2. Migration & Functional Regression Risks
- **Disparity between PHP and Node.js:** The PHP gateway in `api/delivery.php` does not have the Redex direct dispatch routine or label streamer that exists in `api/delivery.js`. Transitioning without verifying the courier dispatch path could break the physical shipping workflow.
- **Commune Resolution Errors with EcoTrack:** Redex uses an exact string dictionary for communes ([`lib/communesMapper.js`](file:///e:/Websites%20On%20Line/yamahasac/lib/communesMapper.js)). If the new dashboard sends freeform commune strings, EcoTrack returns HTTP 422 errors.
- **Double-Counting Revenue / KPI Skew:** If switched orders are created without filtering out the original parent orders from analytics queries, both the old 4,950 DZD order and the new 13,390 DZD order will be added to total revenue, distorting KPIs. Switched-out orders must have a dedicated status excluded from gross revenue.

---

## J. Questions Requiring Product-Owner Decisions

1. **Target Hosting Infrastructure:**
   - *Option A (Recommended):* Host the new Next.js 16 admin dashboard on **Vercel** under a dedicated subdomain (`admin.orva-store.com`), connected directly to Supabase. Storefront remains on Hostinger.
   - *Option B:* Upgrade Hostinger to a VPS running Node.js / Docker to host both the storefront and Next.js admin on a single provider.
2. **Order-Switch Status Lifecycle:**
   - What should the exact status of the original order become when switched? Should it be `switched` (transférée), `cancelled` (annulée), or `archive`?
   - Should switched parent orders be excluded from the main "Toutes les commandes" active view by default via a dedicated tab filter?
3. **Redex / EcoTrack API Direct Mutation vs. Manual Transfer:**
   - Do you want the order-switch modal to attempt an automated API call to update the parcel in EcoTrack if it was already shipped, or do you prefer the safe, decoupled strategy where the operator copies the generated comment and updates EcoTrack manually? (Recommended: Manual decoupled to prevent courier driver confusion).
4. **Authentication & Multi-User Access:**
   - Should the new dashboard use single master password authentication (current approach) or full Supabase Auth with individual staff email accounts and role-based permissions (Super Admin vs. Confirmation Agent vs. Packing Staff)?

---

## K. Proposed Implementation Phases with Dependencies and Acceptance Criteria

### Phase 1: Security Hardening & Credential Sanitization
- **Dependencies:** Access to Supabase Project Dashboard and Vercel/Hostinger environment settings.
- **Tasks:**
  1. Revoke `anon` and `authenticated` `UPDATE`/`DELETE` privileges on `public.orders`.
  2. Implement RLS policies requiring authenticated service role for administrative mutations.
  3. Rotate exposed Supabase database password and remove plaintext connection strings from Git history.
  4. Enforce bearer token authorization on all `/api/*` endpoints.
- **Acceptance Criteria:**
  - An unauthorized `curl -X DELETE` or `PATCH` to `/api/orders` or `/api/delivery` returns HTTP 401.
  - Direct REST calls with only the public anon key fail on `DELETE` and `UPDATE`.

### Phase 2: Supabase Schema Migration for Order Switch
- **Dependencies:** Phase 1 complete.
- **Tasks:**
  1. Execute declarative SQL migration adding `parent_order_id`, `switched_to_order_id`, `switch_status`, and creating the `public.order_switches` table.
  2. Implement database trigger or RPC function for atomic order switching.
- **Acceptance Criteria:**
  - Database schema validates foreign keys without data loss.
  - Test record creation links parent and child orders bidirectionally.

### Phase 3: Next.js 16 UI Dashboard Integration
- **Dependencies:** Phase 2 complete.
- **Tasks:**
  1. Configure `next-shadcn-admin-dashboard-baseui-main` with Supabase server client (`@supabase/ssr`).
  2. Connect `@tanstack/react-table` in `recent-orders.tsx` to live Supabase order queries.
  3. Port Algeria 58-Wilaya selector, Redex commune resolver, and RTL/Arabic display.
  4. Implement `OrderSwitchDialog` component with live pack selection, difference calculation, and 1-click EcoTrack comment copy button.
- **Acceptance Criteria:**
  - Next.js dashboard compiles cleanly via `npm run build` without TypeScript or Biome errors.
  - Admin operators can search, filter, update statuses, and execute order switches with zero UI lag.
  - EcoTrack transfer comment is accurately formatted and copied to clipboard with one click.

### Phase 4: Staging Validation & Production Cutover
- **Dependencies:** Phase 3 complete.
- **Tasks:**
  1. Run sandbox test of storefront order creation -> confirmation -> order switch -> courier dispatch.
  2. Verify Meta CAPI and Telegram notification delivery.
  3. Point `admin.orva-store.com` to the modernized dashboard.
- **Acceptance Criteria:**
  - Storefront checkout on `orva-store.com` operates continuously without interruption.
  - No duplicate orders are sent to Redex Delivery.
