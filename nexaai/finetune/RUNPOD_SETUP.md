# Running the fine-tune on RunPod

Concrete steps to actually train and serve the model, once you have a validated dataset from
`npm run finetune:generate` + `npm run finetune:validate`.

## 1. Rent a training pod

- Go to [runpod.io](https://runpod.io) -> Pods -> Deploy.
- Pick a template with Axolotl pre-installed (search "Axolotl" in the template gallery), or a plain
  PyTorch/CUDA template and `pip install axolotl` yourself.
- GPU: **1x A100 80GB** is enough for QLoRA on Llama 3.1 8B. On-demand pricing is roughly $1.50-2.50/hr
  depending on availability — a full fine-tuning run (3 epochs over a few thousand examples) typically
  finishes in 1-4 hours, so each run costs single-digit dollars.

## 2. Upload your dataset and config

```bash
# From your local machine, once the pod is running:
scp finetune/data/combined.jsonl root@<pod-ip>:/workspace/finetune/data/
scp finetune/axolotl-llama3-8b-qlora.yml root@<pod-ip>:/workspace/finetune/
```

(Or just `git clone` this repo on the pod and copy the dataset in — whichever's easier for you.)

## 3. Train

```bash
cd /workspace
huggingface-cli login   # Llama 3.1 is gated — accept Meta's license on huggingface.co first
axolotl train finetune/axolotl-llama3-8b-qlora.yml
```

Watch the loss curve. If it's not decreasing steadily, the dataset likely needs more examples or better
variety — go back to `generateSyntheticData.ts` before spending more GPU time.

## 4. Merge the LoRA adapter

QLoRA produces a small adapter, not a standalone model — merge it into the base weights for serving:

```bash
axolotl merge-lora finetune/axolotl-llama3-8b-qlora.yml --lora-model-dir finetune/outputs/nexaai-llama3-8b-qlora
```

## 5. Serve it with vLLM

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model finetune/outputs/nexaai-llama3-8b-qlora/merged \
  --served-model-name nexaai-llama3-8b \
  --port 8000
```

This exposes a real `/v1/chat/completions` endpoint, OpenAI-SDK compatible. Test it:

```bash
curl http://<pod-ip>:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"nexaai-llama3-8b","messages":[{"role":"user","content":"my car is making a grinding noise when I brake"}]}'
```

## 6. Move to a persistent endpoint for the app

A training pod is billed by the hour and isn't meant to stay up as your production backend. Once you're
happy with the merged model:
- Push the merged weights to a private Hugging Face repo (or RunPod's network storage).
- Deploy a **separate** RunPod pod (or RunPod Serverless, for scale-to-zero on uneven traffic) running just
  `vllm serve <your-model>` as the always-on (or on-demand) inference endpoint.
- Point NexaAi's server at that endpoint — see `finetune/README.md`'s "Wiring it into NexaAi" section for
  the code-side change.

## Budget reality check against $10K

| Item | Cost |
|---|---|
| Synthetic data generation (Together.ai) | ~$50-300 for a few thousand examples |
| Fine-tuning experiments (dozens of runs while iterating) | ~$500-1,500 |
| Persistent hosting, 8B model, always-on | ~$1,100-1,800/month |
| Persistent hosting, 8B model, serverless (scale-to-zero) | Often $100-500/month at low/uneven traffic, plus cold-start latency |

$10K realistically funds the data + fine-tuning work outright, plus **several months to a year** of hosting
depending on whether you go always-on or serverless — comfortably enough to validate whether the fine-tuned
model is actually good enough for real users before committing to longer-term hosting costs.
