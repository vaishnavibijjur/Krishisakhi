"""
Download all required Hugging Face models for local caching.
Run once: python download_models.py
Models download into HF standard cache (HUGGINGFACE_HUB_CACHE / ~/.cache/huggingface).
Subsequent FastAPI starts reuse the cache — no re-download.
"""
import os
# HF_TOKEN must be set in your environment or .env file — never hardcode it here.
# export HF_TOKEN=hf_... (or add to .env)

print("=" * 55)
print("Krishi Sakhi — Local Model Pre-download")
print("=" * 55)

# 1. BGE-M3 (via sentence-transformers — used for every chat query)
print("\n[1/3] Downloading BAAI/bge-m3 ...")
try:
    from sentence_transformers import SentenceTransformer
    m = SentenceTransformer("BAAI/bge-m3")
    print("      DONE — BGE-M3 cached locally.")
except Exception as e:
    print(f"      FAILED: {e}")

# 2. Whisper Small (STT — lazy loaded on first voice request, pre-cache now)
print("\n[2/3] Downloading openai/whisper-small ...")
try:
    from transformers import pipeline
    p = pipeline("automatic-speech-recognition", model="openai/whisper-small")
    print("      DONE — Whisper cached locally.")
    del p
except Exception as e:
    print(f"      FAILED: {e}")

# 3. IndicTrans2 (translation — optional, non-fatal if fails)
print("\n[3/3] Downloading IndicTrans2 models ...")
try:
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    for mid in [
        "ai4bharat/indictrans2-indic-en-dist-200M",
        "ai4bharat/indictrans2-en-indic-dist-200M",
    ]:
        print(f"      Downloading {mid} ...")
        AutoTokenizer.from_pretrained(mid, trust_remote_code=True)
        AutoModelForSeq2SeqLM.from_pretrained(mid, trust_remote_code=True)
        print(f"      DONE — {mid} cached.")
except Exception as e:
    print(f"      FAILED (non-fatal, translation will be disabled): {e}")

print("\n" + "=" * 55)
print("Pre-download complete. FastAPI will reuse cached models.")
print("=" * 55)
