#!/usr/bin/env python3
"""
Micro LoRA training for Qwen 1.8B on CPU
"""
import json
import os
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model, TaskType

# Configuration
MODEL_NAME = "Qwen/Qwen1.5-1.8B"
DATASET_PATH = os.path.join(os.path.dirname(__file__), '..', 'dataset.jsonl')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'qwen-jokes-lora')

# LoRA config
LORA_R = 4
LORA_ALPHA = 8
LORA_DROPOUT = 0.05
TARGET_MODULES = ["q_proj", "v_proj"]

# Training config
BATCH_SIZE = 1
GRADIENT_ACCUMULATION = 4
EPOCHS = 2
MAX_STEPS = 200
LEARNING_RATE = 2e-4
MAX_LENGTH = 256


def load_dataset():
    """Load JSONL dataset"""
    data = []
    with open(DATASET_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                data.append(json.loads(line))
    return Dataset.from_list(data)


def tokenize_function(examples, tokenizer):
    """Tokenize instruction-output pairs"""
    prompts = []
    for instr, out in zip(examples['instruction'], examples['output']):
        prompt = f"<|im_start|>system\nTu es un humoriste français.\n<|im_end|>\n<|im_start|>user\n{instr}\n<|im_end|>\n<|im_start|>assistant\n{out}\n<|im_end|>"
        prompts.append(prompt)

    return tokenizer(prompts, truncation=True, max_length=MAX_LENGTH, padding=False)


def main():
    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("Loading model (CPU mode)...")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        trust_remote_code=True,
        device_map="cpu",
        low_cpu_mem_usage=True,
    )

    print("Configuring LoRA...")
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    print("Loading dataset...")
    dataset = load_dataset()
    print(f"Dataset size: {len(dataset)}")

    print("Tokenizing...")
    tokenized = dataset.map(
        lambda x: tokenize_function(x, tokenizer),
        batched=True,
        remove_columns=dataset.column_names,
    )

    print("Setting up training...")
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION,
        num_train_epochs=EPOCHS,
        max_steps=MAX_STEPS,
        learning_rate=LEARNING_RATE,
        logging_steps=10,
        save_steps=50,
        save_total_limit=2,
        fp16=False,
        bf16=False,
        remove_unused_columns=False,
        report_to=[],
    )

    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=data_collator,
    )

    print("Starting training...")
    trainer.train()

    print(f"Saving model to {OUTPUT_DIR}")
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    print("Training complete!")


if __name__ == "__main__":
    main()
