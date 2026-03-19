import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.hourly(
  'sync-x-bookmarks-hourly',
  {
    minuteUTC: 15,
  },
  internal.sync.runScheduledSyncs,
)

export default crons
