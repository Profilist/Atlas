# Atlas

Atlas is a personal research and inspiration workspace. It turns bookmarked X posts and links into visual category boards (e.g. I have categories for design, ML research, agents, opportunities).

The product goal is simple:
- import X bookmarks and manually pasted links
- analyze every item with Gemini
- place the item onto a board automatically
- let the user search for custom categories and render the results as a temporary whiteboard

## Product Summary

The whiteboard experience is powered by `tldraw`. It is a tool for:
- automatic ingestion
- automatic categorization
- visual bookmark cards with inline media
- persistent saved board layouts
- hybrid semantic + text search

The intended frontend style is minimal:
- Geist Sans for UI and body copy
- Geist Pixel for display accents
- low-chrome navigation
- restrained colors
- lots of whitespace

## Tech Stack

- Frontend: `@tanstack/react-start`, `@tanstack/react-router`, React 19
- Backend: Convex
- Auth: Better Auth with Google sign-in
- X integration: X OAuth 2.0 authorization code flow with PKCE
- AI: Gemini via `@google/genai`
- Whiteboard: `tldraw`
- Hosting target: Cloudflare via `@cloudflare/vite-plugin` + `wrangler`

## Core Product Guidelines

- Every item will resolve to a concrete board target.
- The system should prefer reusing an existing board before creating a new one.
- There is no inbox route and no pending-review state.
- X post media should be visible on-board whenever possible.
- Link-only items should still have a useful visual preview when an OG image exists.
- Search should produce a temporary board-like result, not a plain list.
- TanStack server routes are reserved for raw HTTP concerns like auth and OAuth callbacks.
- App data access should remain primarily Convex-driven rather than custom REST endpoints.

## User Experience Flow

### 1. Sign in

The app currently uses Google sign-in through Better Auth. This is app authentication, not X authentication.

Relevant files:
- [convex/auth.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/auth.ts)
- [src/routes/login.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/login.tsx)
- [src/routes/api/auth/$.ts](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/api/auth/$.ts)

### 2. Connect X

After signing into the app, the user connects X. The app uses OAuth 2.0 user auth with PKCE and requests:
- `bookmark.read`
- `tweet.read`
- `users.read`
- `offline.access`

This is important: app-only bearer tokens are not enough for bookmarks. The code expects an X OAuth 2.0 client ID and secret.

Relevant files:
- [src/routes/api/x/connect.ts](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/api/x/connect.ts)
- [src/routes/api/x/callback.ts](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/api/x/callback.ts)
- [convex/connections.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/connections.ts)
- [convex/sync.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/sync.ts)

### 3. Ingest items

Items enter the system in two ways:
- X bookmark sync
- manual URL paste on a board

Manual link ingestion creates queued items and schedules background analysis. X sync imports raw posts, media metadata, and then schedules the same downstream routing pipeline.

Relevant files:
- [convex/manualLinks.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/manualLinks.ts)
- [convex/sync.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/sync.ts)
- [convex/itemPipeline.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/itemPipeline.ts)

### 4. AI analysis and routing

Gemini generates:
- concise summary text for the card
- tags
- a board choice: existing board or new board

The fallback logic is intentionally deterministic enough that the app still routes items when Gemini is unavailable or low quality.

Relevant files:
- [convex/itemPipeline.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/itemPipeline.ts)
- [convex/boards.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/boards.ts)
- [convex/validators.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/validators.ts)

### 5. Render persistent boards

Each board shows its cards in a `tldraw` canvas using a custom shape util. The card surface is not a generic text block: it is a bookmark card with title, summary, tags, and media preview tiles.

Saved board state currently stores card positions and dimensions in a JSON snapshot uploaded to Convex file storage.

Relevant files:
- [src/components/BoardCanvas.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/components/BoardCanvas.tsx)
- [src/components/BookmarkCardShapeUtil.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/components/BookmarkCardShapeUtil.tsx)
- [src/routes/_authenticated/boards.$boardId.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/boards.$boardId.tsx)
- [convex/boards.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/boards.ts)

### 6. Search as a temporary whiteboard

Search is category-scoped by default but supports all-board search as well. The current implementation:
- gathers full-text hits
- gathers vector hits from embeddings
- combines and scores them
- groups results into clusters
- lays them out as a generated whiteboard response

This is a board-like search result, not a regular search result list.

Relevant files:
- [src/routes/_authenticated/search.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/search.tsx)
- [convex/search.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/search.ts)
- [convex/searchIndex.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/searchIndex.ts)

## Architecture Overview

### Frontend architecture

TanStack Start owns routing and document rendering.

Important route behavior:
- authenticated pages live under `/_authenticated/*`
- auth gating happens in `beforeLoad`
- board and search routes use `ssr: 'data-only'`
- loaders are treated as isomorphic, so secrets and privileged API work should not live in loaders

Relevant files:
- [src/routes/__root.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/__root.tsx)
- [src/routes/_authenticated.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated.tsx)
- [src/router.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/router.tsx)

### Backend architecture

Convex owns:
- database schema
- queries, mutations, and actions
- file storage
- X sync orchestration
- board snapshots
- search retrieval
- scheduled syncs

High-level pattern:
- public queries and mutations power the app UI
- actions handle external IO and model calls
- internal functions support orchestration and background work

### Auth boundary

There are two distinct auth systems in the product:

- App auth:
  - Google sign-in through Better Auth
  - creates a local `users` row
- X account connection:
  - separate OAuth 2.0 connection after sign-in
  - stores user-scoped X access credentials in `xConnections`

Do not conflate them. Google authenticates the user into the app. X authorizes bookmark import.

## Routes

Public and authenticated routes currently implemented:

- `/login`
- `/`
- `/_authenticated/boards/$boardId`
- `/_authenticated/search`
- `/_authenticated/settings/connections`
- `/api/auth/$`
- `/api/x/connect`
- `/api/x/callback`

Route files:
- [src/routes/login.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/login.tsx)
- [src/routes/index.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/index.tsx)
- [src/routes/_authenticated/boards.$boardId.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/boards.$boardId.tsx)
- [src/routes/_authenticated/search.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/search.tsx)
- [src/routes/_authenticated/settings.connections.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/settings.connections.tsx)

## Data Model

Defined in [convex/schema.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/schema.ts).

### `users`

Local app users derived from Better Auth.

### `xConnections`

Stores the linked X account and tokens for bookmark sync.

### `boards`

Persistent board metadata:
- name
- slug
- description
- whether the board was auto-created
- item count

### `items`

Canonical bookmark/post records. Important fields:
- `sourceType`: `x` or `link`
- `sourceId`
- `canonicalUrl`
- `title`
- `summary`
- `contentText`
- `searchText`
- `tags`
- `boardId`
- `embedding`

Important indexes:
- `by_user_and_source_id`
- `by_user_and_canonical_url`
- `by_user_and_board`
- search index on `searchText`
- vector index on `embedding`

### `itemAssets`

Media associated with an item. This powers inline board previews.

Kinds:
- `image`
- `video`
- `gif`
- `link-preview`

### `boardMemberships`

Currently modeled for many-to-many board membership, although the current app logic primarily uses `items.boardId` as the main board assignment.

### `boardSnapshots`

Stores versioned board layout snapshots in Convex storage.

### `syncRuns`

Tracks sync history and simple operational status.

## AI and Search Details

### Current Gemini models

Defaults in the code:
- text model: `gemini-2.5-flash`
- embedding model: `gemini-embedding-001`

These can be overridden with environment variables if needed.

### Link extraction

Manual links are fetched server-side and parsed with `cheerio`.

Current extraction behavior:
- read OG title/description/image when available
- read a slice of body text
- generate a `link-preview` asset when an image exists

### X bookmark ingestion

Current X sync imports:
- tweet text
- author
- created time
- attached media
- preview URLs

The board card render layer limits display to a small media subset for usability.

### Search implementation

Search is hybrid, not purely vector:
- full-text hits come from Convex search indexes
- semantic hits come from Convex vector search
- the app merges both result sets into a combined score

This is intentionally simple and pragmatic. It is not a separate search service.

## Board Rendering Details

`tldraw` is used as a rendering/runtime canvas, but this app does not expose full general-purpose tldraw persistence.

Current persistence model:
- board snapshots store position and size for each card
- the card content itself comes from Convex item data
- canvas session state is effectively ephemeral

The current custom card shape uses:
- title
- summary
- source label
- tags
- up to four media tiles

If a card has no media, it still renders as a useful text card.

## Visual System

The design intent is minimalist and should stay that way unless there is a deliberate product change.

Current implementation:
- self-hosted Geist fonts in `public/fonts`
- `@font-face` declarations in [src/styles/app.css](C:/Users/Larris/Documents/VSCodeFiles/x/src/styles/app.css)
- Geist Sans for the main UI
- Geist Pixel for display accents

Do not casually replace this with a generic component-library visual style. The product is intentionally sparse.

## Environment Variables

Base template:
- [`.env.example`](C:/Users/Larris/Documents/VSCodeFiles/x/.env.example)

Current required variables:

```env
CONVEX_DEPLOYMENT=dev:your-deployment
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
VITE_APP_URL=http://localhost:3000
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-me
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
X_CLIENT_ID=replace-me
X_CLIENT_SECRET=replace-me
X_CALLBACK_URL=http://localhost:3000/api/x/callback
GEMINI_API_KEY=replace-me
```

Notes:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are for app login only.
- `X_CLIENT_ID` and `X_CLIENT_SECRET` are for connecting the user’s X account.
- X bookmarks require X OAuth 2.0 user auth. App bearer tokens are not enough.
- `X_CALLBACK_URL` must exactly match the callback configured in the X developer portal.
- `SITE_URL` is used by Better Auth.

## Local Development

### Install

```bash
npm install
```

### Start Convex

```bash
npx convex dev
```

This will give you real `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` values if the project is not already linked.

### Start the app

```bash
npm run dev
```

This runs:
- Vite on port `3000`
- Convex dev in parallel

### Useful commands

```bash
npm run dev
npm run build
npm run typecheck
npm run codegen
```

## File Map

### Frontend

- [src/routes](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes): route definitions
- [src/components](C:/Users/Larris/Documents/VSCodeFiles/x/src/components): shell, board canvas, custom card rendering
- [src/lib](C:/Users/Larris/Documents/VSCodeFiles/x/src/lib): auth helpers, board types, redirect utilities
- [src/styles/app.css](C:/Users/Larris/Documents/VSCodeFiles/x/src/styles/app.css): main design system and layout styles

### Backend

- [convex/schema.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/schema.ts): main data model
- [convex/auth.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/auth.ts): Better Auth + local user bridge
- [convex/manualLinks.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/manualLinks.ts): manual URL ingestion
- [convex/sync.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/sync.ts): X bookmark sync
- [convex/itemPipeline.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/itemPipeline.ts): extraction, Gemini classification, embeddings
- [convex/boards.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/boards.ts): board queries and snapshot persistence
- [convex/search.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/search.ts): hybrid search board generation

## For Agents/Developers

Start by reading:
- [README.md](C:/Users/Larris/Documents/VSCodeFiles/x/README.md)
- [package.json](C:/Users/Larris/Documents/VSCodeFiles/x/package.json)
- [convex/schema.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/schema.ts)
- [convex/itemPipeline.ts](C:/Users/Larris/Documents/VSCodeFiles/x/convex/itemPipeline.ts)
- [src/routes/__root.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/__root.tsx)
- [src/routes/_authenticated/boards.$boardId.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/boards.$boardId.tsx)
- [src/routes/_authenticated/search.tsx](C:/Users/Larris/Documents/VSCodeFiles/x/src/routes/_authenticated/search.tsx)

Then verify the baseline with:

```bash
npm run typecheck
npm run build
```

If both pass, the next change should be made against a known-good starting point.
