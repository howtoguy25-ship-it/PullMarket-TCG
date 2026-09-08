# NexaAi fine-tuning pipeline

Tooling to build your own fine-tuned Llama model for NexaAi, instead of calling the Claude API at runtime. This
directory is intentionally decoupled from the running app (`server/`, `client/`) — it's offline tooling you run
by hand, not something the app imports.

## The honest picture

- **This makes NexaAi's brain something you fully control** (no third-party usage policy, no per-token API cost,
  no rate limit you don't set yourself) **in exchange for owning GPU hosting and ML-ops work indefinitely.**
- **A fine-tuned Llama 8B will not match Claude on broad general knowledge and reasoning.** Fine-tuning teaches a
  model your app's *tasks and format* — it doesn't add general intelligence the base model didn't already have.
  If NexaAi's users ask genuinely novel things outside the fine-tuning categories, quality will visibly drop
  compared to what you had with Claude.
- **The synthetic data generator defaults to an open-weight teacher model (Together.ai/Fireworks), not Claude or
  GPT** — see `lib/teacherProvider.ts`'s header comment. Both Anthropic's and OpenAI's commercial terms restrict
  using their outputs to train a competing model, which is exactly what this pipeline does. Keep it on the
  open-weight default unless you've separately confirmed you're not violating those terms for your use case.

## Pipeline

```
1. Generate synthetic data  ->  finetune/generateSyntheticData.ts
2. Validate it              ->  finetune/validateDataset.ts
3. Fine-tune Llama           ->  (outside this repo — see below)
4. Serve it                 ->  vLLM/TGI, OpenAI-compatible endpoint
5. Point the app at it       ->  swap server/src/lib/anthropic.ts's provider (see "Wiring it into NexaAi" below)
```

### 1. Generate synthetic data

```bash
cd nexaai
cp .env.example .env   # fill in TOGETHER_API_KEY (or FIREWORKS_API_KEY)
npm run finetune:generate -- --count=20                       # ~20 examples x each topic in topics.ts
npm run finetune:generate -- --count=30 --category=car_trouble # just one category
```

Writes one JSON object per line to `finetune/data/synthetic-<timestamp>.jsonl`, in OpenAI/ShareGPT chat format
(`{"messages": [{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}`) — directly usable by
Axolotl's `chat_template` dataset type.

`topics.ts` defines the task categories (car trouble, baking, investing, who-is lookups, tech troubleshooting,
health/fitness, travel, camera-ask-style questions, agent-builder drafts) with real seed prompts pulled from
NexaAi's actual feature set. Add more categories/seeds there as you learn what your real users actually ask.

### 2. Validate it

```bash
npm run finetune:validate -- finetune/data/synthetic-<timestamp>.jsonl
```

Catches mechanical problems (empty fields, missing `**bold heading**` formatting, wildly short/long replies) and
prints a per-category count. **This does not replace actually reading ~20-30 examples yourself** — synthetic data
inherits whatever quirks/biases the teacher model has, and the only way to catch that is to read it.

### 3. Fine-tune + 4. Serve

`axolotl-llama3-8b-qlora.yml` is a real starting config (QLoRA on Llama 3.1 8B Instruct) pointed at this
pipeline's dataset format. `RUNPOD_SETUP.md` walks through renting the GPU, running the training job, merging
the LoRA adapter, and serving the result with vLLM behind a real OpenAI-compatible endpoint — plus a budget
table showing what a ~$10K budget actually covers (short version: the fine-tuning itself is cheap, tens to low
hundreds of dollars; hosting an always-on 8B endpoint is the real ongoing cost, roughly $1,100-1,800/month).

### Wiring it into NexaAi

`server/src/lib/anthropic.ts` is currently the only place that calls an LLM. To point NexaAi at your self-hosted
model instead: write a sibling file (e.g. `lib/selfHostedModel.ts`) that calls your vLLM endpoint's
`/v1/chat/completions` using the same `AskParams`/`AskResult` shape `askNexaAi`/`streamNexaAi` already use, then
swap the import in `routes/chat.ts`. Ask for this as a follow-up task once you have a real endpoint URL to point
at — it's a quick change, but needs your endpoint to exist first.
