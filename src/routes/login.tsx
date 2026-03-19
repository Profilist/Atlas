import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { sanitizeRedirect } from '@/lib/redirect'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.isAuthenticated) {
      throw redirect({ to: search.redirect || '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  const [isLoading, setIsLoading] = useState(false)

  async function handleGoogleSignIn() {
    await authClient.signIn.social(
      {
        provider: 'google',
        callbackURL: search.redirect || '/',
      },
      {
        onRequest: () => {
          setIsLoading(true)
        },
        onSuccess: () => {
          setIsLoading(false)
        },
        onError: () => {
          setIsLoading(false)
        },
      },
    )
  }

  return (
    <div className="app-center">
      <div className="panel hero-panel stack-xl">
        <div className="stack-md">
          <p className="eyebrow">Personal Tool</p>
          <h1 className="display">Turn saved links and X bookmarks into living boards.</h1>
          <p className="muted hero-copy">
            Gemini classifies every item automatically, media stays visible on the board, and search
            opens a fresh whiteboard around what matters.
          </p>
        </div>

        <div className="stack-md">
          <button className="button button-primary button-lg" disabled={isLoading} onClick={handleGoogleSignIn}>
            {isLoading ? 'Redirecting...' : 'Continue With Google'}
          </button>
          <p className="muted">Google is the only app sign-in method in v1.</p>
        </div>
      </div>
    </div>
  )
}
