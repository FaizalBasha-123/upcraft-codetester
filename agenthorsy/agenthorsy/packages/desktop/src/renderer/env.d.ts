import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __AGENTHORSY__?: {
      deepLinks?: string[]
    }
  }
}
