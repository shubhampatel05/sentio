# Sentio — Usage Guide

**Sentio** is a local voice emotion analysis tool that analyzes speech audio to detect emotions through acoustic and prosodic features. Record your voice or upload an audio file, and Sentio identifies the emotion carried in the speech.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Features](#features)
3. [How to Use the Web Interface](#how-to-use-the-web-interface)
4. [API Endpoints](#api-endpoints)
5. [Training Your Own Model](#training-your-own-model)
6. [Dataset Preparation](#dataset-preparation)
7. [Understanding the Results](#understanding-the-results)
8. [Technical Details](#technical-details)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Configuration](#advanced-configuration)

---

## Quick Start

### Installation

```bash
# Clone or navigate to the project directory
cd sentio

# Create and activate virtual environment
python3 -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Running the Application

```bash
python app.py
```

Open your browser to **http://127.0.0.1:5000**

---

## Features

### Emotion Detection
Sentio recognizes **8 distinct emotions**:
- **Happy** — Positive, elevated mood
- **Calm** — Relaxed, peaceful state
- **Sad** — Low energy, melancholic
- **Angry** — High tension, negative arousal
- **Fearful** — Anxious, threatened
- **Surprised** — High arousal, unexpected
- **Disgust** — Rejection, distaste
- **Neutral** — Balanced, no strong emotion

### Two Recognition Modes

#### 1. Heuristic Mode (Default)
- Uses research-grounded acoustic analysis
- Always available, no training needed
- Provides **affective dimensions**:
  - **Arousal** — Energy level (0.0 = low, 1.0 = high)
  - **Valence** — Positivity/negativity (0.0 = negative, 1.0 = positive)
  - **Tension** — Stress level (0.0 = relaxed, 1.0 = tense)
- Based on speech-emotion research (Scherer 2003, Banse & Scherer 1996)

#### 2. Trained Model Mode (Optional)
- Uses machine learning (Random Forest classifier)
- Requires training on labeled dataset
- Higher accuracy (70-80% on RAVDESS dataset)
- Automatically used when `model.joblib` exists

---

## How to Use the Web Interface

### Recording Audio

1. **Click the microphone button** to start recording
2. **Speak a full sentence** (at least 1-2 seconds)
   - Use natural speech with emotion
   - Speak clearly but don't exaggerate
3. **Click again to stop** recording
4. **Click "Analyze reading"** to process

### Uploading Audio Files

1. **Drag and drop** a file onto the capture card, or
2. **Click to browse** and select a file

**Supported formats:**
- `.wav` (uncompressed PCM)
- `.flac` (lossless compression)
- `.ogg` (Vorbis codec)

**Maximum file size:** 15 MB

### Understanding the Display

#### Emotion Probabilities
- **Horizontal bars** show relative likelihood of each emotion
- **Percentages** are normalized to sum to 100%
- **"Close call"** indicator when top two emotions are within 5%

#### Affective Dimensions (Heuristic mode only)
- **Arousal meter** — Energy and activation level
- **Valence meter** — Emotional positivity/negativity
- **Tension meter** — Stress and discomfort level

#### Raw Features Panel
- **Pitch Mean** — Average fundamental frequency (Hz)
- **Pitch Variability** — Standard deviation of F0 (Hz)
- **Energy** — RMS amplitude
- **Tempo** — Estimated speech tempo (BPM)
- **Speech Rate** — Onsets per second
- **Brightness** — Spectral centroid (Hz)

#### Waveform Visualization
- Amplitude envelope of the audio signal
- Visual confirmation of recording quality

---

## API Endpoints

### POST `/api/analyze`

Analyze an audio file for emotion.

**Request:**
```bash
curl -X POST http://127.0.0.1:5000/api/analyze \
  -F "audio=@recording.wav"
```

**Response (Heuristic mode):**
```json
{
  "source": "heuristic",
  "dominant_emotion": "happy",
  "emotion_meta": {
    "color": "#4FD6A3",
    "label": "Happy"
  },
  "probabilities": {
    "happy": 0.3421,
    "calm": 0.2134,
    "neutral": 0.1523,
    "surprised": 0.1245,
    "sad": 0.0876,
    "angry": 0.0432,
    "fearful": 0.0234,
    "disgust": 0.0135
  },
  "dimensions": {
    "arousal": 0.723,
    "valence": 0.812,
    "tension": 0.334
  },
  "duration": 2.45,
  "raw_features": {
    "pitch_mean_hz": 185.3,
    "pitch_variability_hz": 42.1,
    "energy": 0.0521,
    "tempo_bpm": 126.4,
    "speech_rate_ops": 3.27,
    "brightness_hz": 2341.2
  },
  "waveform_preview": [0.1234, 0.2341, ...],
  "emotion_colors": { ... },
  "emotion_labels": { ... }
}
```

**Response (Trained model):**
```json
{
  "source": "trained_model",
  "dominant_emotion": "happy",
  "probabilities": { ... },
  "dimensions": null,
  ...
}
```

**Error Responses:**
- `400` — No audio file received
- `422` — Audio too short (< 0.6 seconds)
- `500` — Unsupported format or processing error

### GET `/api/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

---

## Training Your Own Model

Training a custom model on labeled data dramatically improves accuracy.

### Step 1: Download a Dataset

#### Option A: Manual Download (Recommended)

**RAVDESS Dataset** (most popular, 1440 files, 24 actors)

1. Visit: https://zenodo.org/record/1188976
2. Download: `Audio_Speech_Actors_01-24.zip` (215 MB)
3. Save to: `sentio/downloads/`

#### Option B: Quick Test with Sample

Download 5 actors individually (~50 MB total):
- https://zenodo.org/record/1188976/files/Actor_01.zip
- https://zenodo.org/record/1188976/files/Actor_02.zip
- https://zenodo.org/record/1188976/files/Actor_03.zip
- https://zenodo.org/record/1188976/files/Actor_04.zip
- https://zenodo.org/record/1188976/files/Actor_05.zip

Extract to: `downloads/sample/`

#### Option C: Use Your Own Recordings

Organize your recordings in the required folder structure (see Dataset Preparation).

### Step 2: Organize the Dataset

```bash
# For RAVDESS dataset
python prepare_dataset.py \
  --source ./downloads/ravdess_raw/Audio_Speech_Actors_01-24 \
  --output ./dataset \
  --format ravdess

# For sample (5 actors)
python prepare_dataset.py \
  --source ./downloads/sample \
  --output ./dataset \
  --format ravdess

# For other datasets
python prepare_dataset.py \
  --source ./path/to/dataset \
  --output ./dataset \
  --format [crema-d|tess|generic]
```

**This will:**
- Scan all `.wav` files recursively
- Parse emotion labels from filenames
- Copy files to emotion-specific folders
- Report statistics and class balance

### Step 3: Train the Model

```bash
# Full training (500 trees, good accuracy)
python train_model_improved.py \
  --data ./dataset \
  --out model.joblib \
  --n-estimators 500

# Fast training (fewer trees, faster)
python train_model_improved.py \
  --data ./dataset \
  --out model.joblib \
  --n-estimators 200

# High accuracy training (more trees, slower)
python train_model_improved.py \
  --data ./dataset \
  --out model.joblib \
  --n-estimators 1000
```

**Training output includes:**
- Training and test accuracy
- 5-fold cross-validation scores
- Per-emotion precision, recall, F1-score
- Confusion matrix
- Top 10 most important features
- Overfitting warnings
- Class imbalance warnings

**Expected results:**
- **Full RAVDESS (24 actors):** 70-80% accuracy, 5-10 minutes training
- **Sample (5 actors):** 50-60% accuracy, 1-2 minutes training

### Step 4: Use the Trained Model

Simply restart the Flask app:

```bash
python app.py
```

The app automatically detects and loads `model.joblib`. Results will show `"source": "trained_model"`.

---

## Dataset Preparation

### Required Folder Structure

```
dataset/
├── happy/*.wav
├── sad/*.wav
├── angry/*.wav
├── fearful/*.wav
├── surprised/*.wav
├── disgust/*.wav
├── calm/*.wav
└── neutral/*.wav
```

### Supported Dataset Formats

#### RAVDESS Format
**Filename:** `03-01-06-01-02-01-12.wav`

Emotion codes (3rd field):
- `01` = neutral
- `02` = calm
- `03` = happy
- `04` = sad
- `05` = angry
- `06` = fearful
- `07` = disgust
- `08` = surprised

#### CREMA-D Format
**Filename:** `1001_DFA_ANG_XX.wav`

Emotion codes (3rd field):
- `ANG` = angry
- `DIS` = disgust
- `FEA` = fearful
- `HAP` = happy
- `NEU` = neutral
- `SAD` = sad

#### TESS Format
**Filename:** `OAF_back_angry.wav`

Emotion is the last field before `.wav`:
- `angry`, `disgust`, `fear`, `happy`, `ps` (surprised), `sad`, `neutral`

#### Generic Format
For custom recordings, organize files manually into emotion folders, or use parent folder names:

```
my_recordings/
├── happy/recording1.wav
├── sad/recording2.wav
└── ...
```

```bash
python prepare_dataset.py \
  --source ./my_recordings \
  --output ./dataset \
  --format generic
```

### Recording Tips for Custom Datasets

- **Duration:** 2-5 seconds per clip
- **Content:** Use consistent phrases or sentences
- **Quality:** 16-bit PCM WAV, 16 kHz or higher sample rate
- **Samples:** At least 20-30 examples per emotion
- **Balance:** Try to have similar counts for each emotion
- **Variety:** Multiple speakers if possible
- **Natural:** Don't over-act; use realistic emotional speech

---

## Understanding the Results

### Emotion Probabilities Explained

**Probabilities are relative shares**, not calibrated confidence scores:
- The model compares the audio against all 8 emotions
- Higher percentage = stronger match to that emotion
- Sum always equals 100%

**Example:**
```
happy:     34.2%  ← Strongest match
calm:      21.3%
neutral:   15.2%
...
```

**Interpreting "close calls":**
When the top two emotions are within 5%, the emotion is ambiguous. This is normal — human emotions often blend.

### Affective Dimensions (Heuristic Mode)

These three dimensions underlie all emotions:

**Arousal (0.0 - 1.0):**
- Low (0.0-0.3): Calm, sad, tired
- Medium (0.4-0.6): Neutral, content
- High (0.7-1.0): Happy, angry, fearful, surprised

**Valence (0.0 - 1.0):**
- Negative (0.0-0.3): Angry, sad, fearful, disgust
- Neutral (0.4-0.6): Neutral, surprised
- Positive (0.7-1.0): Happy, calm

**Tension (0.0 - 1.0):**
- Low (0.0-0.3): Calm, happy, neutral
- Medium (0.4-0.6): Surprised, disgust
- High (0.7-1.0): Angry, fearful

These map to points in 3D space. The heuristic scorer measures distance to reference points.

### Source Indicator

- `"source": "heuristic"` — Using default acoustic analysis
- `"source": "trained_model"` — Using trained classifier

---

## Technical Details

### Feature Extraction

Sentio extracts **28 acoustic features** using librosa:

**Prosodic Features:**
- Pitch (F0): mean, std, range, jitter
- Energy (RMS): mean, std
- Tempo: beats per minute
- Speech rate: onsets per second

**Spectral Features:**
- Spectral centroid (brightness)
- Spectral bandwidth
- Spectral rolloff
- Spectral contrast
- Zero-crossing rate

**Cepstral Features:**
- 13 MFCCs (Mel-frequency cepstral coefficients)

### Audio Processing Pipeline

1. **Decode** — Load audio bytes (WAV/FLAC/OGG)
2. **Convert** — Resample to 22050 Hz, convert to mono
3. **Trim** — Remove leading/trailing silence (25 dB threshold)
4. **Validate** — Reject clips shorter than 0.6 seconds
5. **Extract** — Compute all 28 features
6. **Classify** — Score via heuristic or trained model
7. **Format** — Package results with metadata

### Machine Learning Details

**Algorithm:** Random Forest Classifier

**Pipeline:**
1. StandardScaler — Normalize features to zero mean, unit variance
2. RandomForestClassifier — Ensemble of decision trees

**Training configuration:**
- `n_estimators`: 200-1000 trees (default 500)
- `max_depth`: 20 (prevents overfitting)
- `min_samples_split`: 5
- `min_samples_leaf`: 2
- `class_weight`: "balanced" (handles imbalanced data)
- `random_state`: 42 (reproducible results)

**Evaluation:**
- 80/20 train/test split (stratified)
- 5-fold cross-validation
- Metrics: accuracy, precision, recall, F1-score, confusion matrix

**Model persistence:**
The trained model is saved with:
- Fitted pipeline (scaler + classifier)
- Feature names (for consistency)
- Training metadata (sample counts, emotion distribution)

---

## Troubleshooting

### Application Issues

**Problem:** `ModuleNotFoundError: No module named 'flask'`

**Solution:**
```bash
# Make sure virtual environment is activated
# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

---

**Problem:** "That clip is too short to read"

**Solution:**
- Record for at least 1-2 seconds
- Speak a full sentence, not just a word
- Check that you're not hitting silence detection threshold

---

**Problem:** "That file couldn't be read. Supported formats are WAV, FLAC, and OGG"

**Solution:**
- Convert MP3/M4A files to WAV using ffmpeg:
  ```bash
  ffmpeg -i input.mp3 -ar 22050 -ac 1 output.wav
  ```
- Ensure file is not corrupted
- Check file extension matches actual format

---

**Problem:** Application won't start on port 5000

**Solution:**
```bash
# Check if port is in use
# Windows
netstat -ano | findstr :5000

# macOS/Linux
lsof -i :5000

# Change port in app.py (line 48)
app.run(debug=True, host="0.0.0.0", port=5001)
```

---

### Training Issues

**Problem:** "No .wav files found in [source]"

**Solution:**
- Check that source path is correct
- Ensure files have `.wav` extension (case-sensitive on Linux/macOS)
- Try absolute paths instead of relative paths

---

**Problem:** "Not enough samples found"

**Solution:**
- You need at least 20 total samples across all emotions
- Download the full RAVDESS dataset
- Check that `prepare_dataset.py` completed successfully
- Verify `dataset/` folder structure

---

**Problem:** Low accuracy (< 50%)

**Solutions:**
- **Use more data** — Full RAVDESS gives 70-80% accuracy
- **Balance classes** — Ensure similar sample counts per emotion
- **Increase trees** — Try `--n-estimators 1000`
- **Check quality** — Remove corrupted or mislabeled samples
- **Accept limits** — Emotion recognition is subjective; 70% is good

---

**Problem:** "Warning: Possible overfitting detected"

**Explanation:**
Training accuracy >> test accuracy means the model memorized training data.

**Solutions:**
- Collect more diverse training data
- Reduce `--n-estimators` (fewer trees)
- The model already has max_depth=20 to help prevent this
- Add data augmentation (pitch shift, time stretch, noise)

---

**Problem:** "Warning: Class imbalance detected"

**Explanation:**
Some emotions have 3x+ more samples than others.

**Impact:**
Model will favor emotions with more samples.

**Solutions:**
- Balance your dataset manually
- The model already uses `class_weight="balanced"`
- Collect more samples for underrepresented emotions
- Use data augmentation on minority classes

---

### Dataset Download Issues

**Problem:** Download timeout or very slow

**Solution:**
- Use browser download instead of scripts (more reliable)
- Try Kaggle as alternative source
- Download individual Actor files instead of full ZIP
- Check your internet connection

---

**Problem:** "ZIP corrupted error"

**Solution:**
```bash
# Delete partial download
rm downloads/ravdess.zip

# Re-download with browser (supports resume)
```

---

**Problem:** Need more disk space

**Requirements:**
- RAVDESS ZIP: ~215 MB
- Extracted: ~300 MB
- Dataset organized: ~300 MB
- **Total:** ~800 MB free space needed

---

## Advanced Configuration

### Customizing Emotion Colors

Edit `emotion_engine.py`, lines 43-52:

```python
EMOTION_META = {
    "happy":     {"color": "#4FD6A3", "label": "Happy"},
    "calm":      {"color": "#4FD6A3", "label": "Calm"},
    # ... edit colors here
}
```

Colors follow the "Obsidian & Ember" design system:
- `#4FD6A3` (mint) — Positive/neutral emotions
- `#6FA8FF` (sky) — Elevated or low-energy emotions
- `#FF5C7A` (rose) — Tense/negative emotions

---

### Adjusting Feature Weights (Heuristic Mode)

Edit `emotion_engine.py`, `score_emotions()` function (lines 160-210):

```python
# Arousal calculation (line 162)
arousal = (
    0.30 * _minmax(features["energy_mean"], 0.005, 0.25)
    + 0.20 * _minmax(features["tempo"], 60, 180)
    # ... adjust weights here
)
```

These weights are based on speech-emotion literature but can be tuned for your use case.

---

### Changing Model Hyperparameters

Edit `train_model_improved.py`, lines 105-113:

```python
RandomForestClassifier(
    n_estimators=n_estimators,  # Number of trees
    max_depth=20,               # Max tree depth (lower = less overfitting)
    min_samples_split=5,        # Min samples to split node
    min_samples_leaf=2,         # Min samples per leaf
    class_weight="balanced",    # Handle imbalance
    n_jobs=-1                   # Use all CPU cores
)
```

---

### Running Offline

The web interface loads external resources from CDNs:
- Fonts: Plus Jakarta Sans, Inter, JetBrains Mono (Google Fonts)
- Libraries: Three.js, GSAP (cdnjs)

To run fully offline:

1. Download the resources:
   ```bash
   mkdir -p static/vendor
   
   # Download Three.js r128
   curl -o static/vendor/three.min.js \
     https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
   
   # Download GSAP
   curl -o static/vendor/gsap.min.js \
     https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js
   
   curl -o static/vendor/ScrollTrigger.min.js \
     https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js
   ```

2. Edit `templates/index.html` to point `<script>` tags to local files

3. Download fonts or use system fallbacks (already configured)

---

### Maximum Upload Size

Default: 15 MB (configured in `app.py`, line 10)

To change:

```python
MAX_UPLOAD_BYTES = 30 * 1024 * 1024  # 30 MB
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
```

---

### Emotion Anchor Points (Heuristic Mode)

Reference points in (arousal, valence, tension) space are defined in `emotion_engine.py`, lines 185-194:

```python
anchors = {
    "happy":     (0.75, 0.80, 0.35),  # High arousal, positive, low tension
    "surprised": (0.85, 0.60, 0.55),  # Very high arousal, neutral-positive
    "angry":     (0.80, 0.25, 0.80),  # High arousal, negative, high tension
    # ... etc.
}
```

Adjust these based on your understanding of emotional space or your specific use case.

---

## Project Structure

```
sentio/
├── app.py                          # Flask application and API routes
├── emotion_engine.py               # Feature extraction and emotion scoring
├── train_model_improved.py         # Model training script with evaluation
├── prepare_dataset.py              # Dataset organization utility
├── requirements.txt                # Python dependencies
├── model.joblib                    # Trained model (created by training)
│
├── templates/
│   └── index.html                  # Web interface HTML
│
├── static/
│   ├── css/
│   │   └── style.css              # Design system styles
│   └── js/
│       ├── main.js                # UI state machine and interaction
│       ├── recorder.js            # Audio recording and encoding
│       ├── backdrop.js            # 3D background (Three.js)
│       └── fx.js                  # Visual effects and animations
│
├── dataset/                        # Organized training data (created by prepare_dataset.py)
│   ├── happy/*.wav
│   ├── sad/*.wav
│   └── ...
│
├── downloads/                      # Downloaded datasets
│   └── download_ravdess.py        # Optional download script
│
├── README.md                       # Project overview and design documentation
├── SETUP_INSTRUCTIONS.txt          # Quick setup guide
└── USAGE.md                        # This file
```

---

## Additional Resources

### Supported Datasets

- **RAVDESS** — https://zenodo.org/record/1188976 (recommended)
- **CREMA-D** — https://github.com/CheyneyComputerScience/CREMA-D
- **TESS** — https://tspace.library.utoronto.ca/handle/1807/24487
- **SAVEE** — http://kahlan.eps.surrey.ac.uk/savee/

### Speech-Emotion Research References

- Scherer, K. R. (2003). Vocal communication of emotion: A review of research paradigms. *Speech Communication*, 40(1-2), 227-256.
- Banse, R., & Scherer, K. R. (1996). Acoustic profiles in vocal emotion expression. *Journal of Personality and Social Psychology*, 70(3), 614-636.

### Dependencies

- **Flask** 3.0.3 — Web framework
- **librosa** 0.10.2 — Audio analysis
- **scikit-learn** 1.5.1 — Machine learning
- **numpy** 1.26.4 — Numerical computing
- **soundfile** 0.12.1 — Audio I/O
- **joblib** 1.4.2 — Model serialization

---

## Credits

**Sentio** uses:
- **librosa** for audio feature extraction
- **scikit-learn** for machine learning
- **Flask** for the web API
- **Three.js** for 3D visualization
- **GSAP** for smooth animations

The heuristic scoring approach is grounded in speech-emotion research literature. The trained model mode demonstrates how to upgrade from a demo heuristic to production-grade accuracy using labeled data.

---

## License

Check the project repository for license information.

---

**Last updated:** November 4, 2026
