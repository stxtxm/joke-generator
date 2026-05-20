import os
import sys
import google.generativeai as genai

# Get API key from environment
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY not set")
    sys.exit(1)

genai.configure(api_key=api_key)

# Setup the model
model = genai.GenerativeModel('gemini-1.5-flash')

def generate_joke(prompt="Raconte une blague courte en français."):
    try:
        response = model.generate_content(prompt)
        print(response.text)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "Raconte une blague courte en français."
    generate_joke(prompt)
