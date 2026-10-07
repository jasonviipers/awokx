# Project code and security audit — 2026-10-07

The audit and verified cleanup are complete. Several significant trading safeguards remain incomplete; this report is **not a live-trading readiness approval**. Severity reflects the code's ability to cause unintended orders, exceed risk limits, or disclose data, rather than only conventional web exploits.

## Scope and method

Reviewed the Worker entry points, Durable Objects, MCP tools and approval flow, policy engine, Alpaca/OKX and LLM integrations, scraper/news/social providers, strategy execution, D1 queries and migrations, dashboard source/build configuration, setup scripts, dependency manifests/lockfiles, CI, and deployment examples. Traced security-sensitive data and order paths, checked callers before deleting code, compiled both applications, ran regression tests, and consulted current package advisories.

The source graph covers backend and dashboard modules, type imports, re-exports, literal dynamic imports, CSS imports, tests, runtime entry points and build scripts. Exported-helper cleanup also used project-wide caller searches and compiler verification. No live orders, remote migrations, Access-policy updates or deployment were performed. Cloudflare storage semantics, actual broker permissions, existing Access policies, fills, and production data were not integration-tested.

## Highest-priority remaining findings

### H1 — Daily loss and cooldown limits lack a fill-driven producer

**Evidence:** `src/policy/engine.ts:114` and `:130` read `cooldown_until` and `daily_loss_usd`. `src/storage/d1/queries/risk-state.ts` reads/resets these fields, but the application does not reconcile broker fills into them. The former `recordDailyLoss` and `setCooldown` functions had no callers and were removed. `memory-log-outcome` writes the journal, not risk state.

**Trigger/impact:** After an autonomous losing trade, the daily-loss counter can remain zero and cooldown can remain absent. Both guards then permit another trade despite configured loss limits.

**Required correction:** Reconcile fills with durable, idempotent fill IDs and a defined realized-loss calculation, persist loss/cooldown atomically, and define the risk-day boundary. Test partial fills, duplicate events, losses, restarts and midnight transitions. Do not substitute unrealized P/L for realized loss without defining that policy.

### H2 — Pending orders are absent from exposure reservations

**Evidence:** `src/core/policy-broker.ts` validates broker positions/account state and invalidates its cache after order submission. MCP submits now revalidate fresh state, but neither path reserves risk for accepted, unfilled orders in a shared ledger.

**Trigger/impact:** Multiple buys can each observe the same cash and position count before fills become positions. Parallel MCP calls or later alarm cycles can exceed maximum positions, exposure or cash allocation. Separate single-use approval tokens prevent token replay, but do not serialize different orders.

**Required correction:** Use a shared serialized order coordinator with durable reservations; include working orders in policy calculations and reconcile releases on fills, cancellations and rejection. Test simultaneous distinct approvals and delayed fills. A kill arriving after a policy check can also race an in-flight broker request; pending-order cancellation needs explicit semantics.

### H3 — OKX positions do not provide cost basis for exits

**Evidence:** `src/providers/okx/trading.ts:228` sets average entry price, cost basis and unrealized P/L to zero. `src/strategy/default/rules/crypto-trading.ts:126` derives take-profit/stop-loss percentages from unrealized P/L. OKX portfolio history returns a single current snapshot with zero P/L.

**Trigger/impact:** For a positive-value OKX holding, the calculated gain/loss is zero. Percentage stop-loss and take-profit conditions do not activate, and dashboard performance cannot be trusted as historical performance.

**Required correction:** Build durable cost-basis and equity-history tracking from actual fills, including balances that existed before this agent, fees, partial sales and transfers. Test loss/profit exits against reconciled broker fixtures. Unsupported performance should display as unavailable until that data exists.

### H4 — Missing D1 risk row fails open

**Evidence:** `getRiskState` in `src/storage/d1/queries/risk-state.ts:15` returns an inactive kill switch and zero loss when row 1 is missing. Kill-switch updates use `UPDATE ... WHERE id = 1` without verifying that a row changed. The initial migration supplies the row in a correctly initialized database.

**Trigger/impact:** An incompletely initialized or damaged database silently disables stored guards; a kill request may report success while persisting no row.

**Required correction:** Fail closed when risk state is missing or malformed, and initialize/verify the singleton transactionally. Test missing-row and zero-update cases. Deployment setup should verify migrations before enabling execution.

## Other remaining findings

| Priority | Finding and evidence | Recommended correction |
| --- | --- | --- |
| Medium | LLM JSON is still parsed and cast to types in `mahoraga-harness.ts` research/analyst paths and `crypto-trading.ts`. Invalid confidence is blocked at the main trading thresholds now, but actions, symbols, array sizes and free-text content remain incompletely validated. News/social text can influence model instructions. | Apply bounded Zod schemas to every LLM result, constrain actionable symbols to researched/held instruments, and test malformed output and adversarial source text. Keep deterministic policy outside the model. |
| Medium | Public status in `mahoraga-harness.ts` passes signals, research, entry metadata, premarket plans and staleness objects directly through. Account/config/log projections are allowlisted; those other objects are not. | Define projections for all public objects, including free text and future added fields. Public financial data is an explicit feature; the concern is disclosure beyond its documented contract. No actual leaked credential was demonstrated. |
| Medium | Public cache misses each call `build()` before filling `publicCache` (`mahoraga-harness.ts:1364`). Parallel misses can fan out broker requests. The outer public limiter is optional. | Cache an in-flight promise per key, clear it on failure, and require a limiter when public mode is enabled. Existing configured rate limiting reduces this risk. |
| Medium | `min_price` and `min_avg_volume` are configured and validated but are not enforced by the policy engine. Options with unavailable delta only produce a warning. Funds/positions from providers also lack comprehensive finite-value validation. | Either enforce the advertised guards using trustworthy market data or remove the settings and claims. Reject unavailable mandatory inputs. |
| Medium | Dashboard contracts differ from backend payloads: `PremarketPlan` uses `highConvictionPlays`/`marketOutlook`, while the backend emits `high_conviction`/`market_summary`; staleness uses `score`/`shouldExit`, while the backend emits `staleness_score`/`isStale`. `overnightActivity` is not produced. | Share response schemas or map wire payloads explicitly. Test actual backend-shaped fixtures; current mocks and compilation cannot detect these mismatches. Public config is correctly typed as partial. |
| Medium | `src/storage/d1/queries/trades.ts:30` stores notional dollars in the quantity column when quantity is absent. The schema requires quantity, and no active fill reconciliation updates the recorded trade afterward. | Store requested notional separately and distinguish requested quantity from actual filled quantity. Use a local tested migration and fill reconciliation; do not reinterpret existing records without a repair plan. |
| Medium | `calculateMACD` in `src/providers/technicals.ts:78` seeds the short EMA from 12 prices but starts subsequent updates at index 26, skipping intermediate samples for the signal line. Flat-series RSI returns 100. | Correct EMA alignment and define a neutral flat-series RSI convention; verify against independently calculated reference series before changing trade behavior. |
| Medium | Enable/disable/trigger/kill routes in the harness accept methods other than POST. Authentication is required, but GET can produce a side effect. | Enforce POST with 405 responses for mutation routes and test every alias. Bearer authentication reduces traditional cross-site request forgery exposure. |
| Medium | Several external fetches, including raw LLM and market/news calls, lack consistent deadlines and response-size caps. AI SDK completion does not forward the requested JSON response-format setting. | Apply cancellation deadlines and provider-specific bounded parsing. Use validated structured output supported by the selected provider. Test timeout behavior and continued alarm scheduling. |
| Medium | Log redaction covers credential-shaped object keys, including nested arrays, but cannot reliably identify secrets embedded inside arbitrary error/reason strings. Custom provider base URLs can also be configured insecurely. | Avoid recording raw provider errors/bodies, redact known secret values at logging boundaries, and require HTTPS for credential-bearing endpoints outside explicitly configured local development. |
| Low | `src/jobs/cron.ts` uses fixed UTC schedules for market-open/close/reset work. These do not follow New York daylight-saving time; crypto has a different 24/7 risk-day requirement. | Use timezone-aware scheduling decisions with a documented risk-day boundary. |
| Medium / operational | `scripts/setup-access.ts` exits early when an Access application already exists; the new email allowlist requirement does not repair an older permissive policy. | Inspect and reconcile existing policies explicitly. Their actual remote state was not accessed during this audit. |

## Resolved findings and cleanup

| Area | Changes |
| --- | --- |
| SSRF and resource exhaustion | Scraper requires HTTPS, permitted hosts, no credentials and the expected port; follows redirects manually and validates every destination; caps redirect count and streamed bytes; keeps its deadline active while reading the body. Redirect validation follows the [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). |
| Approval integrity | Nested objects are hashed canonically; stored order content is checked against its signed hash; expiry rejects invalid dates and the exact expiry boundary; empty signing secrets fail. The generated approval ID now matches the persisted ID. |
| Approval scope and stale decisions | Signed previews bind the endpoint scope and broker. Regular and options submissions load fresh account, positions, clock, risk, policy and current market valuation before execution, then atomically claim the token. Older unscoped outstanding approvals are intentionally rejected and need a new preview. This does not solve H2. |
| Order valuation | Preview requires exactly one of quantity/notional. Market orders cannot use caller-supplied limit/stop prices to understate valuation. Policies reject invalid valuations/equity and blocked accounts; options require valid cost, quantity and DTE. |
| Autonomous orders | Strategy contexts load the stored D1 policy, cap stock limits with agent limits and merge the blacklist. Autonomous options pass options policy against fresh state and are restricted to Alpaca. A successful option buy no longer falls through to buy its underlying stock. Missing/non-finite/out-of-range confidence is rejected at affected entry thresholds. |
| Kill switch and quota | Harness kill persists the shared D1 kill state. API quota is checked and reserved atomically, covers MCP, and uses a fixed object key rather than token fragments. Emergency kill is available when normal quota is exhausted. H2/H4 remain relevant. |
| Logging | Tool logs await their input hash before binding to D1; credential-shaped keys are redacted case-insensitively, preserving arrays. Harness log metadata cannot be overwritten by details. |
| Stored policy | Loaded policy JSON now passes validation; malformed booleans, symbol filters, non-finite limits, unsupported order types and fractional position counts are rejected. Invalid legacy stored policies may require repair before orders work again. |
| Access setup | Empty email allowlists fail before external calls; newly created policies cannot default to everyone. The CLI uses Bun instead of downloading an undeclared `tsx` runner. |
| Dependencies | Locked patched `@modelcontextprotocol/client` 2.2.0 as the agents package's required runtime peer and overrode transitive `sharp` to 0.35.5. See the [MCP client advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h) and [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). The former affects OAuth client code; this app's server role alone does not demonstrate that exploit. Sharp is reached through the development toolchain. |
| Duplicate code | Shared token comparison and sleep utilities replace duplicates. SEC Atom parsing now has one shared implementation used by the provider and strategy gatherer; each caller preserves its filtering behavior. |

Removed six unreachable modules: `providers/llm/index.ts`, `providers/social/stocktwits.ts`, `storage/kv/{client,keys}.ts`, and `storage/r2/{client,paths}.ts`. The active StockTwits gatherer, Worker bindings, migration tables and existing stored data were retained.

Removed 24 additional functions with no project callers: `truncate`; `filterExpirationsByDTE`; `isLLMConfigured`; `getConfiguredProviders`; `getRecentApprovals`; `getRawEvent`; `getRecentRawEvents`; `getStructuredEvent`; `markEventValidated`; `linkEventToTrade`; `getActiveEventSources`; `updateEventSourcePollTime`; `getJournalEntry`; `createMemoryRule`; `savePolicyConfig`; `recordDailyLoss`; `setCooldown`; `getToolLogs`; `getToolLogsByRequestId`; `updateTradeStatus`; `getTradeByAlpacaOrderId`; `getTradeById`; `getRecentTrades`; `getTradesToday`. Also removed unused harness convenience wrappers, legacy session handlers, Sparkline UI code and orphan types. Removed helpers were not a substitute for implementing the missing features described above.

All remaining direct dependencies were found to serve source imports, build/test tools, type declarations or required runtime peers. No used dependency was removed. `@modelcontextprotocol/client` is required indirectly and deliberately retained. TypeScript unused-import/parameter checking remains enabled. `audit:unused` and root/dashboard vulnerability checks, plus the dashboard build, were added to CI. The source checker reports candidates rather than destructively deleting future dynamically referenced code. It is a conservative graph check, not an exhaustive unused-export or clone detector.

Backend formatting was normalized to pass Biome; `.gitattributes` keeps backend source line endings consistent on Windows.

## Verification

| Check | Result |
| --- | --- |
| Backend TypeScript | Pass |
| Backend Biome formatting, lint and import organization | Pass |
| Regression suite | 275 tests across 22 files pass |
| Dashboard TypeScript and production bundle | Pass |
| Worker Wrangler dry-run bundle | Pass; no deployment |
| Unused source/dependency graph | No remaining findings |
| Backend dependency audit | No known vulnerabilities across 340 packages |
| Dashboard dependency audit | No known vulnerabilities across 105 packages |
| Frozen lockfile installs with lifecycle scripts disabled | Pass in both applications |
| Limited secret check | `.env` and `.dev.vars` are ignored/untracked; no tracked instances found in their path history. Signature search found example placeholders, not confirmed live credentials. |

Security regression tests cover nested hashing/redaction, empty signing secrets, approval tampering/scope/expiry/IDs, invalid policy/valuation inputs, SSRF redirects, response limits, awaited log hashes, and concurrent quota reservations. They do not cover real exchange fills, all MCP callbacks, live Cloudflare concurrency, or every dashboard interaction. The secret check is not a complete historical secret scan. Dependency scans only cover published advisories at scan time.

Implement H1–H4 and broker-specific fill/concurrency tests before treating configured trading limits as reliable. Then address response contracts, public projections and validated LLM output.
