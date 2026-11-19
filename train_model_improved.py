"""
train_model_improved.py
-----------------------
Enhanced training script with cross-validation, confusion matrix, and better reporting.
This will help you understand how well your model actually performs.

Usage:
    python train_model_improved.py --data ./dataset --out model.joblib --n-estimators 1000
"""

import argparse
import glob
import os
import warnings

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from emotion_engine import EMOTIONS, extract_features, load_audio

warnings.filterwarnings("ignore")


def featurize_file(path):
    """Extract features from a single audio file."""
    with open(path, "rb") as f:
        audio_bytes = f.read()
    y, sr = load_audio(audio_bytes)
    feats = extract_features(y, sr)
    names = sorted(feats.keys())
    return np.array([feats[k] for k in names]), names


def load_dataset(data_path):
    """Load all audio files from the dataset folder structure."""
    X, y_labels, feature_names = [], [], None
    emotion_counts = {}

    print("Loading dataset...")
    print("-" * 60)

    for emotion in EMOTIONS:
        folder = os.path.join(data_path, emotion)
        if not os.path.isdir(folder):
            print(f"[!] [{emotion}] folder not found - skipping")
            continue

        files = glob.glob(os.path.join(folder, "*.wav"))
        emotion_counts[emotion] = 0

        for path in files:
            try:
                vec, names = featurize_file(path)
                X.append(vec)
                y_labels.append(emotion)
                feature_names = names
                emotion_counts[emotion] += 1
            except Exception as e:
                print(f"  [!] Skipping {os.path.basename(path)}: {e}")

        if emotion_counts[emotion] > 0:
            print(f"[OK] [{emotion:10s}] {emotion_counts[emotion]:4d} samples loaded")

    print("-" * 60)
    print(f"Total samples: {len(X)}")

    # Remove empty emotion categories
    emotion_counts = {k: v for k, v in emotion_counts.items() if v > 0}

    # Check for class imbalance
    if len(emotion_counts) > 1:
        counts = list(emotion_counts.values())
        max_count = max(counts)
        min_count = min(counts)

        if min_count > 0 and max_count / min_count > 3:
            print(f"[!] Warning: Class imbalance detected (ratio: {max_count/min_count:.1f}:1)")
            print("    Consider balancing your dataset or using data augmentation")

    return np.array(X), y_labels, feature_names, emotion_counts


def train_and_evaluate(X, y_labels, n_estimators, feature_names):
    """Train the model and provide comprehensive evaluation."""

    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_labels, test_size=0.2, stratify=y_labels, random_state=42
    )

    print(f"\nTraining set: {len(X_train)} samples")
    print(f"Test set:     {len(X_test)} samples")
    print(f"Features:     {len(feature_names)}")
    print(f"Random Forest with {n_estimators} trees...")
    print("-" * 60)

    # Create pipeline
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=n_estimators,
            random_state=42,
            class_weight="balanced",  # Handle class imbalance
            max_depth=20,             # Prevent overfitting
            min_samples_split=5,
            min_samples_leaf=2,
            n_jobs=-1                 # Use all CPU cores
        )),
    ])

    # Train
    print("Training model...")
    pipeline.fit(X_train, y_train)

    # Evaluate on training set
    train_pred = pipeline.predict(X_train)
    train_acc = accuracy_score(y_train, train_pred)

    # Evaluate on test set
    test_pred = pipeline.predict(X_test)
    test_acc = accuracy_score(y_test, test_pred)

    print(f"\n{'='*60}")
    print(f"RESULTS")
    print(f"{'='*60}")
    print(f"Training accuracy:   {train_acc:.3f} ({train_acc*100:.1f}%)")
    print(f"Test accuracy:       {test_acc:.3f} ({test_acc*100:.1f}%)")

    # Check for overfitting
    if train_acc - test_acc > 0.15:
        print(f"\n[!] Warning: Possible overfitting detected!")
        print(f"    Training accuracy is {(train_acc-test_acc)*100:.1f}% higher than test accuracy")
        print(f"    Consider: reducing n_estimators, collecting more data, or using data augmentation")

    # Cross-validation
    print(f"\nPerforming 5-fold cross-validation...")
    cv_scores = cross_val_score(pipeline, X, y_labels, cv=5, n_jobs=-1)
    print(f"CV scores: {[f'{s:.3f}' for s in cv_scores]}")
    print(f"Mean CV accuracy: {cv_scores.mean():.3f} (±{cv_scores.std():.3f})")

    # Detailed classification report
    print(f"\n{'='*60}")
    print("PER-EMOTION PERFORMANCE")
    print(f"{'='*60}")
    print(classification_report(y_test, test_pred, zero_division=0))

    # Confusion matrix
    print("CONFUSION MATRIX")
    print("-" * 60)
    cm = confusion_matrix(y_test, test_pred, labels=sorted(set(y_labels)))
    unique_labels = sorted(set(y_labels))

    # Print header
    print(f"{'Actual':>12s} | " + " ".join([f"{l[:4]:>5s}" for l in unique_labels]))
    print("-" * 60)

    # Print rows
    for i, true_label in enumerate(unique_labels):
        row = cm[i]
        print(f"{true_label:>12s} | " + " ".join([f"{val:>5d}" for val in row]))

    # Feature importance
    print(f"\n{'='*60}")
    print("TOP 10 MOST IMPORTANT FEATURES")
    print(f"{'='*60}")
    clf = pipeline.named_steps['clf']
    importances = clf.feature_importances_
    indices = np.argsort(importances)[::-1][:10]

    for i, idx in enumerate(indices, 1):
        print(f"{i:2d}. {feature_names[idx]:25s} {importances[idx]:.4f}")

    return pipeline, feature_names


def main():
    parser = argparse.ArgumentParser(description="Train a voice-emotion classifier with detailed evaluation.")
    parser.add_argument("--data", required=True, help="Path to the labeled dataset folder.")
    parser.add_argument("--out", default="model.joblib", help="Output path for the trained model.")
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=500,
        help="Number of decision trees in the random forest (default: 500).",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=20,
        help="Minimum total samples required to proceed with training (default: 20).",
    )
    args = parser.parse_args()

    if args.n_estimators < 1:
        parser.error("--n-estimators must be at least 1.")

    # Load dataset
    X, y_labels, feature_names, emotion_counts = load_dataset(args.data)

    if len(X) < args.min_samples:
        print(f"\n❌ Error: Not enough samples found ({len(X)} < {args.min_samples}).")
        print("\nExpected folder structure:")
        print("  dataset/")
        print("      happy/*.wav")
        print("      sad/*.wav")
        print("      angry/*.wav")
        print("      fearful/*.wav")
        print("      surprised/*.wav")
        print("      disgust/*.wav")
        print("      calm/*.wav")
        print("      neutral/*.wav")
        return

    # Train and evaluate
    pipeline, feature_names = train_and_evaluate(X, y_labels, args.n_estimators, feature_names)

    # Save model
    print(f"\n{'='*60}")
    model_data = {
        "pipeline": pipeline,
        "feature_names": feature_names,
        "training_samples": len(X),
        "emotion_counts": emotion_counts,
    }
    joblib.dump(model_data, args.out)
    print(f"[OK] Model saved to: {args.out}")
    print(f"\nRestart the Flask app - it will now use this trained model automatically.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
