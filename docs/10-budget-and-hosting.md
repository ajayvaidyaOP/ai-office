# Budget and hosting

A ₹0 **software** starting cost is possible: self-hosted n8n, local Ollama, free Google
Sheets, free Telegram Bot API. It is not a ₹0 **total** cost — electricity, internet,
storage and your time are real. Hosted AI and cloud servers add ongoing charges.

> Prices, free tiers, quotas and licence terms change. Verify live prices on each provider's
> official page before you publish a budget or buy anything.

## Local vs cloud hosting

| Option | Starting cost | Advantages | Limitations |
| --- | --- | --- | --- |
| Local computer | ₹0 software | private, no server bill, good for learning | stops when the computer sleeps |
| Old laptop / mini PC | ₹0 if already owned | always-on, low power | limited performance and reliability |
| Cloud VM | monthly server cost | always-on, reachable anywhere | ongoing bill, you own security |
| n8n Cloud | subscription | no server maintenance | recurring cost, plan limits |
| Hosted AI API | usage-based | no local hardware | ongoing API cost, data leaves your device |

## Transparent monthly budget (INR)

| Item | ₹0 start | Typical small setup | Notes |
| --- | --- | --- | --- |
| n8n self-hosted | ₹0 | ₹0 | runs on your machine; cloud hosting costs extra |
| Ollama + local model | ₹0 | ₹0 | hardware and electricity still apply |
| This office | ₹0 | ₹0 | Node.js, no paid dependencies |
| Google Sheets | ₹0 | ₹0 | free Google account; API quotas apply |
| Telegram Bot | ₹0 | ₹0 | Bot API is free; Telegram terms apply |
| Hosted AI API | ₹0 if unused | ₹200–₹2,000+ | depends on provider, model, usage |
| Cloud VM | ₹0 if unused | ₹500–₹3,000+ | varies by provider, region, size |
| Domain / email | ₹0 | ₹0–₹1,000+ | optional |
| **Estimated total** | **₹0 software** | **₹700–₹6,000+ per month** | verify live prices |

## What actually costs money

1. **Hosted model calls.** The only cost that grows with success. Cap it:
   `MAX_MODEL_CALLS_PER_DAY=200` and watch the counter in Setup/Status.
2. **Always-on hosting.** A ₹0 laptop that sleeps is not hosting. A small VM is ₹500–₹1,500
   in most regions; a home mini PC costs electricity only.
3. **Your time.** The most expensive line item. A prompt that saves ten minutes a week is
   worth more than a ₹200 API bill; a workflow you never use is not worth either.

## Cost-control rules

- Start on the offline engine and one small local model. Measure before you upgrade.
- Set `MAX_MODEL_CALLS_PER_DAY` to a number you would be comfortable losing.
- Prefer one strong call (structured JSON) over three weak ones.
- Cache repeated answers in the sheet instead of re-asking.
- Review the usage rows in `/api/state` weekly; spikes mean a loop, not productivity.
- For hosted APIs, set a billing alert at the provider **and** a cap here.

## Hardware guidance

| Machine | Local model | Typical use |
| --- | --- | --- |
| 8 GB RAM laptop | 2–3B parameters | learning, drafting, one workflow |
| 16 GB RAM laptop | 7–8B parameters | daily office work, better drafts |
| 16 GB + GPU 8 GB | 8B fast, 14B slow | comfortable daily use |
| Mini PC / old laptop | 2–8B | always-on office, low power |
| Cloud VM (4 vCPU, 8 GB) | none or API | always-on n8n + orchestration |

## Hosting decision tree

```
Does the workflow need to run while you sleep?
├─ No  → local machine + npm start. Done. Cost ₹0.
└─ Yes → Is a home device always on?
         ├─ Yes → old laptop / mini PC + Docker. Cost: electricity.
         └─ No  → cloud VM (₹500–₹3,000) or n8n Cloud (subscription).
                  Keep secrets in the host's secret store, not in the repo.
```

## Choosing between Ollama and a hosted API

| Question | Ollama | Hosted API |
| --- | --- | --- |
| Is privacy critical? | yes → Ollama | no → either |
| Is your hardware modest? | small models only | hosted wins |
| Do you need the best writing? | 8B is decent | larger hosted models win |
| Is cost predictable? | yes (₹0 per call) | no (usage-based) |
| Offline work? | yes | no |

A common compromise: Ollama for routine drafts, a hosted model only for the final polish of
something you will actually publish.

## Publishing this budget

If you share this table publicly, add the date and a "verify before purchase" note. Free
tiers change; a screenshot of last year's price is not a budget.
