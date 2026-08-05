---
name: Node 20 and Supabase compatibility
description: Environment constraint for the imported Express and Supabase backend.
---

The workspace currently runs Node.js 20. Recent Supabase JavaScript releases can require Node.js 22 and native WebSocket support during client initialization, which prevents the Express server from starting.

**Why:** The backend imports Supabase at startup, so an incompatible package fails the entire web workflow before any route can respond.

**How to apply:** Install the `ws` npm package in the backend and configure the Supabase client with `{ realtime: { transport: { WebSocket: require('ws') } } }`. This is confirmed working with supabase-js 2.112+ on Node 20. Alternatively upgrade the workspace runtime to Node 22.