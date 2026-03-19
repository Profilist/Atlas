import { Link, Outlet, useLocation } from '@tanstack/react-router'
import type { Id } from '../../convex/_generated/dataModel'

export function AppShell(props: {
  boards: Array<{
    _id: Id<'boards'>
    name: string
    itemCount: number
  }>
  subtitle?: string
}) {
  const location = useLocation()

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <p className="eyebrow">Atlas</p>
          <h1 className="display display-sm">Boards</h1>
          {props.subtitle ? <p className="muted">{props.subtitle}</p> : null}
        </div>

        <nav className="sidebar__nav">
          <Link
            className="nav-link"
            search={{ boardId: '', q: '' }}
            to="/search"
          >
            Search
          </Link>
          <Link className="nav-link" to="/settings/connections">
            Connections
          </Link>
        </nav>

        <div className="sidebar__boards">
          {props.boards.map((board) => {
            const isActive = location.pathname === `/boards/${board._id}`
            return (
              <Link
                className={isActive ? 'board-link board-link--active' : 'board-link'}
                key={board._id}
                params={{ boardId: board._id }}
                to="/boards/$boardId"
              >
                <span>{board.name}</span>
                <span className="board-link__count">{board.itemCount}</span>
              </Link>
            )
          })}
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
