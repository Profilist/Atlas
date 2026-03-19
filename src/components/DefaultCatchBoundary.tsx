import {
  Link,
  rootRouteId,
  useMatch,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (match) => match.id === rootRouteId,
  })

  console.error(error)

  return (
    <div className="app-center">
      <div className="panel stack-lg error-panel">
        <p className="eyebrow">Something Broke</p>
        <h1 className="display">We hit an unexpected error.</h1>
        <p className="muted">{error.message || 'Try reloading the view.'}</p>
        <div className="row gap-sm">
          <button
            className="button button-primary"
            onClick={() => {
              void router.invalidate()
            }}
          >
            Retry
          </button>
          <Link className="button button-secondary" to={isRoot ? '/' : '.'}>
            {isRoot ? 'Home' : 'Stay Here'}
          </Link>
        </div>
      </div>
    </div>
  )
}
