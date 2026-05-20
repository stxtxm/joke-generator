#!/bin/bash
# Export LoRA adapter to Ollama format

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LORA_DIR="$ROOT_DIR/qwen-jokes-lora"
MODELFILE="$ROOT_DIR/Modelfile"

echo "Creating Modelfile..."
cat > "$MODELFILE" << 'EOF'
FROM qwen:1.8b
ADAPTER ./qwen-jokes-lora
SYSTEM "Tu es un humoriste français avec un humour noir, absurde et cynique. Ta mission: faire rire avec des blagues courtes à twist."
EOF

echo "Modelfile created at $MODELFILE"
echo ""
echo "To create the Ollama model, run:"
echo "  cd $ROOT_DIR"
echo "  ollama create qwen-jokes -f Modelfile"
echo ""
echo "Make sure the LoRA adapter is at: $LORA_DIR"
