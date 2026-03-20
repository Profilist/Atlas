import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/connections')({
  component: ConnectionsRouteComponent,
})

function ConnectionsRouteComponent() {
  const connectionState = useQuery(api.connections.getState, {})
  const disconnectX = useMutation(api.connections.disconnectX)
  const setAutoSyncEnabled = useMutation(api.connections.setAutoSyncEnabled)
  const syncNow = useAction(api.sync.syncNow)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isUpdatingAutoSync, setIsUpdatingAutoSync] = useState(false)

  async function handleSync() {
    setIsSyncing(true)
    try {
      await syncNow({})
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true)
    try {
      await disconnectX({})
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function handleToggleAutoSync() {
    if (!connectionState?.connection) {
      return
    }

    setIsUpdatingAutoSync(true)
    try {
      await setAutoSyncEnabled({
        enabled: !connectionState.connection.autoSyncEnabled,
      })
    } finally {
      setIsUpdatingAutoSync(false)
    }
  }

  return (
    <div className="page stack-lg">
      <header className="page-header">
        <div className="stack-sm">
          <p className="eyebrow">Connections</p>
          <h1 className="display display-sm">Sources and account controls.</h1>
          <p className="muted">Connect X, run a sync, or sign out of the app.</p>
        </div>
      </header>

      <div className="grid-two">
        <section className="panel stack-md">
          <p className="eyebrow">X Bookmarks</p>
          <h2 className="section-title">
            {connectionState?.connection ? `Connected as @${connectionState.connection.username}` : 'Not connected yet'}
          </h2>
          <p className="muted">
            {connectionState?.connection
              ? 'Bookmarks import into boards automatically when you sync, including attached media previews.'
              : 'Connect your X account to import bookmarks directly into the whiteboard.'}
          </p>

          {connectionState?.connection ? (
            <p className="muted">
              Hourly auto sync is{' '}
              {connectionState.connection.autoSyncEnabled ? 'enabled' : 'disabled'}.
              {connectionState.connection.autoSyncEnabled
                ? ' The cron job will check X every hour.'
                : ' Keep it off while testing to avoid extra X API usage.'}
            </p>
          ) : null}

          <div className="row gap-sm">
            <a className="button button-primary" href="/api/x/connect">
              {connectionState?.connection ? 'Reconnect X' : 'Connect X'}
            </a>
            {connectionState?.connection ? (
              <button className="button button-secondary" disabled={isSyncing} onClick={handleSync}>
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            ) : null}
            {connectionState?.connection ? (
              <button
                className="button button-secondary"
                disabled={isUpdatingAutoSync}
                onClick={handleToggleAutoSync}
              >
                {isUpdatingAutoSync
                  ? 'Updating...'
                  : connectionState.connection.autoSyncEnabled
                    ? 'Disable Auto Sync'
                    : 'Enable Auto Sync'}
              </button>
            ) : null}
            {connectionState?.connection ? (
              <button className="button button-secondary" disabled={isDisconnecting} onClick={handleDisconnect}>
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : null}
          </div>
        </section>

        <section className="panel stack-md">
          <p className="eyebrow">Session</p>
          <h2 className="section-title">Google sign-in</h2>
          <p className="muted">This app is single-user and keeps auth deliberately simple.</p>
          <button
            className="button button-secondary"
            onClick={async () => {
              await authClient.signOut()
            }}
          >
            Sign Out
          </button>
        </section>
      </div>
    </div>
  )
}
