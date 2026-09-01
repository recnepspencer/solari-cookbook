import { runEnronOnlineContractWalkthrough } from "./enron-online/story.js"

runEnronOnlineContractWalkthrough().then((result) => {
  console.log(JSON.stringify({ kind: "contract_only_walkthrough", authority: "not_worth_backed", ...result }, null, 2))
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
