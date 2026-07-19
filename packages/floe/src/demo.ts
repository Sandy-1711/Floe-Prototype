import { FloeClient } from "./client.ts";
import { BudgetGuard } from "./budget.ts";
import { runResearchAgent, type AgentEvent } from "./agent.ts";

/**
 * Offline smoke test — runs the full agent in shim mode (no keys, no spend).
 *   pnpm --filter @repo/floe demo
 */

const money = (n: number) => `$${n.toFixed(4)}`;

function log(e: AgentEvent) {
  switch (e.type) {
    case "status":
      console.log(`\n• ${e.message}`);
      break;
    case "advisory":
      console.log(
        `  budget: spent ${money(e.advisory.spentUsd)} / ${money(
          e.advisory.capUsd,
        )} (${(e.advisory.usedBps / 100).toFixed(0)}%)${
          e.advisory.nearLimit ? "  ⚠ near limit" : ""
        }`,
      );
      break;
    case "downshift":
      console.log(`  >> DOWNSHIFT ${e.from} -> ${e.to}  (${e.reason})`);
      break;
    case "plan":
      console.log(`  plan [${e.model}]: ${e.queries.join(" | ")}`);
      break;
    case "spend":
      console.log(
        `   $ ${e.event.vendor}/${e.event.label}: ${money(e.event.amountUsd)}  [${e.event.source}]`,
      );
      break;
    case "search":
      console.log(`  ? "${e.query}" -> ${e.hits.length} hits`);
      break;
    case "blocked":
      console.log(`  X BLOCKED ${e.label}: ${e.reason}`);
      break;
    case "answer":
      console.log(`\n  SAY [${e.model}] ${e.text}`);
      break;
    case "done":
      console.log(
        `\n= DONE  total ${money(e.totalUsd)} / cap ${money(e.capUsd)}  by vendor: ` +
          Object.entries(e.byVendor)
            .map(([v, n]) => `${v}=${money(n)}`)
            .join(", "),
      );
      break;
  }
}

async function run(label: string, capUsd: number) {
  console.log(`\n\n===== ${label} (cap ${money(capUsd)}) =====`);
  const guard = new BudgetGuard({ capUsd });
  const client = new FloeClient({ mode: "shim", guard });
  const result = await runResearchAgent({
    question: "What are the best budget mechanical keyboards under $100?",
    client,
    onEvent: log,
  });
  console.log(
    `\n>> answer len=${result.answer.length}, total=${money(result.totalUsd)}, downshifted=${result.downshifted}`,
  );
}

await run("Comfortable budget", 0.5);
await run("Tight budget", 0.012);
