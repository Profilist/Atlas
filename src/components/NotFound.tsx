import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div className="app-center">
      <div className="panel stack-lg error-panel">
        <p className="eyebrow">Not Found</p>
        <h1 className="display">That page does not exist.</h1>
        <p className="muted">Try heading back to your boards.</p>
        <div className="row gap-sm">
          <button className="button button-secondary" onClick={() => window.history.back()}>
            Go Back
          </button>
          <Link className="button button-primary" to="/">
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
