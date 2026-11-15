#!/usr/bin/env bash
# Quick launch script for Llama Duo Chat
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/.."

echo "=========================================================="
echo "🦙 Starting Llama Duo Arena (Side-by-Side Dual LLM Socket)"
echo "=========================================================="

# Check if Ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✓ Ollama server detected at http://localhost:11434"
else
    echo "ℹ Ollama server not detected on :11434."
    echo "  You can start it in another terminal with: ollama serve"
    echo "  (The Arena will automatically run in simulation mode until Ollama starts)"
fi

echo ""
echo "Launching FastAPI WebSocket server on http://localhost:8000 ..."
./venv/bin/python -m uvicorn llama_duo_chat.app:app --host 0.0.0.0 --port 8000 --reload
