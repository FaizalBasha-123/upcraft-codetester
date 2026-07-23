import path from "path"

process.env.AGENTHORSY_DB = ":memory:"
process.env.AGENTHORSY_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.AGENTHORSY_DISABLE_MODELS_FETCH = "true"
