import type { BoardSnapshot } from '@/lib/board-types'

const DENSE_BOARD_COLUMNS = 3
const DENSE_BOARD_X_STEP = 360
const DENSE_BOARD_Y_STEP = 420

export function getDenseBoardPosition(index: number) {
  return {
    x: (index % DENSE_BOARD_COLUMNS) * DENSE_BOARD_X_STEP,
    y: Math.floor(index / DENSE_BOARD_COLUMNS) * DENSE_BOARD_Y_STEP,
  }
}

export function compactBoardSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  const sortedCards = [...snapshot.cards].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y
    }

    if (left.x !== right.x) {
      return left.x - right.x
    }

    return String(left.itemId).localeCompare(String(right.itemId))
  })

  return {
    version: snapshot.version,
    cards: sortedCards.map((card, index) => ({
      ...card,
      ...getDenseBoardPosition(index),
    })),
  }
}
