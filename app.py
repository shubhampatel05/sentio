from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import traceback

from emotion_engine import analyze_emotion

app = Flask(__name__)
CORS(app)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file was received."}), 400

    file = request.files["audio"]
    audio_bytes = file.read()

    if not audio_bytes:
        return jsonify({"error": "The audio file is empty."}), 400

    try:
        result = analyze_emotion(audio_bytes)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "error": "That file couldn't be read. Supported formats are WAV, FLAC, and OGG."
        }), 500


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
