declare global {
  const AGENTHORSY_VERSION: string
  const AGENTHORSY_CHANNEL: string
}

export const InstallationVersion = typeof AGENTHORSY_VERSION === "string" ? AGENTHORSY_VERSION : "local"
export const InstallationChannel = typeof AGENTHORSY_CHANNEL === "string" ? AGENTHORSY_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
