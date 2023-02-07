from flask import Flask, request
import openai

app = Flask(__name__)
openai.api_key = "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"

@app.route("/generate_text", methods=["POST"])
def generate_text():
    product = request.form["product"]
    target_customer = request.form["target_customer"]
    use_case = request.form["use_case"]
    features = request.form["features"]

    prompt = f"I am selling {product}, to {target_customer}, who would use it for {use_case}. Key features of this item include {features}."

    generated_text = openai.Completion.create(
      model="text-davinci-003",
      prompt=prompt,
      max_tokens=100,
      temperature=0.7,
      stop="\n",
    )

    return str(generated_text['choices'][0]['text'])

if __name__ == "__main__":
    app.run()
