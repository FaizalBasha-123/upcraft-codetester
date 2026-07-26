export const SNAPSHOT_INTERVAL = 50

export function shouldSnapshot(turnNumber: number): boolean {
  return turnNumber % SNAPSHOT_INTERVAL === 0
}
