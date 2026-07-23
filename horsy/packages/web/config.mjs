const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://agenthorsy.ai" : `https://${stage}.agenthorsy.ai`,
  console: stage === "production" ? "https://agenthorsy.ai/auth" : `https://${stage}.agenthorsy.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/agenthorsy",
  discord: "https://agenthorsy.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
