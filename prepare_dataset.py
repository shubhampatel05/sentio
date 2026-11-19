"""
prepare_dataset.py
------------------
Helper script to organize downloaded emotion datasets into the required folder structure.

Supports:
- RAVDESS (Ryerson Audio-Visual Database of Emotional Speech and Song)
- CREMA-D (Crowd-sourced Emotional Multimodal Actors Dataset)
- TESS (Toronto Emotional Speech Set)
- Generic (copies WAV files based on folder names)

Usage:
    python prepare_dataset.py --source ./downloaded_data --output ./dataset --format ravdess
"""

import argparse
import glob
import os
import shutil
from pathlib import Path


EMOTION_MAP = {
    "happy": ["happy", "happiness", "hap"],
    "calm": ["calm", "neutral-calm"],
    "sad": ["sad", "sadness"],
    "angry": ["angry", "anger", "ang"],
    "fearful": ["fearful", "fear", "fea"],
    "surprised": ["surprised", "surprise", "sur", "ps"],  # ps = pleasant surprise
    "disgust": ["disgust", "dis"],
    "neutral": ["neutral", "neu"],
}


def normalize_emotion(emotion_label):
    """Normalize various emotion labels to our 8 standard emotions."""
    emotion_label = emotion_label.lower().strip()

    for target, variants in EMOTION_MAP.items():
        if emotion_label in variants:
            return target

    return None


def parse_ravdess_filename(filename):
    """
    Parse RAVDESS filename format:
    03-01-06-01-02-01-12.wav

    Positions:
    - 3rd field (index 2) = emotion code
      01=neutral, 02=calm, 03=happy, 04=sad, 05=angry, 06=fearful, 07=disgust, 08=surprised
    """
    parts = filename.replace('.wav', '').split('-')
    if len(parts) < 3:
        return None

    emotion_code = parts[2]
    emotion_mapping = {
        '01': 'neutral',
        '02': 'calm',
        '03': 'happy',
        '04': 'sad',
        '05': 'angry',
        '06': 'fearful',
        '07': 'disgust',
        '08': 'surprised',
    }

    return emotion_mapping.get(emotion_code)


def parse_crema_filename(filename):
    """
    Parse CREMA-D filename format:
    1001_DFA_ANG_XX.wav

    Third field = emotion code (ANG, DIS, FEA, HAP, NEU, SAD)
    """
    parts = filename.replace('.wav', '').split('_')
    if len(parts) < 3:
        return None

    emotion_code = parts[2].upper()
    emotion_mapping = {
        'ANG': 'angry',
        'DIS': 'disgust',
        'FEA': 'fearful',
        'HAP': 'happy',
        'NEU': 'neutral',
        'SAD': 'sad',
    }

    return emotion_mapping.get(emotion_code)


def parse_tess_filename(filename):
    """
    Parse TESS filename format:
    OAF_back_angry.wav

    Last part before .wav = emotion
    """
    parts = filename.replace('.wav', '').split('_')
    if len(parts) < 3:
        return None

    emotion = parts[-1].lower()

    # TESS uses slightly different names
    mapping = {
        'angry': 'angry',
        'disgust': 'disgust',
        'fear': 'fearful',
        'happy': 'happy',
        'ps': 'surprised',  # pleasant surprise
        'sad': 'sad',
        'neutral': 'neutral',
    }

    return mapping.get(emotion)


def organize_dataset(source_dir, output_dir, format_type, verbose=True):
    """
    Organize audio files from source into emotion-based folders.

    Args:
        source_dir: Path to downloaded dataset
        output_dir: Path to organized output (will create emotion subfolders)
        format_type: Dataset format (ravdess, crema-d, tess, generic)
        verbose: Print progress
    """
    source_path = Path(source_dir)
    output_path = Path(output_dir)

    # Create output directory structure
    for emotion in EMOTION_MAP.keys():
        (output_path / emotion).mkdir(parents=True, exist_ok=True)

    # Find all WAV files recursively
    wav_files = list(source_path.rglob('*.wav'))

    if not wav_files:
        print(f"❌ No .wav files found in {source_dir}")
        return

    print(f"Found {len(wav_files)} WAV files")
    print(f"Organizing as: {format_type}")
    print("-" * 60)

    stats = {emotion: 0 for emotion in EMOTION_MAP.keys()}
    skipped = 0

    for wav_file in wav_files:
        filename = wav_file.name
        emotion = None

        # Determine emotion based on format
        if format_type == 'ravdess':
            emotion = parse_ravdess_filename(filename)
        elif format_type == 'crema-d':
            emotion = parse_crema_filename(filename)
        elif format_type == 'tess':
            emotion = parse_tess_filename(filename)
        elif format_type == 'generic':
            # Try to infer from parent folder name
            parent_folder = wav_file.parent.name.lower()
            emotion = normalize_emotion(parent_folder)

        if emotion and emotion in EMOTION_MAP:
            # Copy file to appropriate emotion folder
            dest_file = output_path / emotion / filename

            # Handle duplicate filenames
            if dest_file.exists():
                base = dest_file.stem
                ext = dest_file.suffix
                counter = 1
                while dest_file.exists():
                    dest_file = output_path / emotion / f"{base}_{counter}{ext}"
                    counter += 1

            shutil.copy2(wav_file, dest_file)
            stats[emotion] += 1

            if verbose and stats[emotion] % 50 == 0:
                print(f"  {emotion:10s}: {stats[emotion]:4d} files...")
        else:
            skipped += 1
            if verbose and skipped <= 5:
                print(f"  ⚠️  Skipped: {filename} (couldn't determine emotion)")

    # Print summary
    print("-" * 60)
    print("SUMMARY")
    print("-" * 60)

    total_copied = 0
    for emotion in sorted(EMOTION_MAP.keys()):
        count = stats[emotion]
        total_copied += count
        status = "✓" if count > 0 else "✗"
        print(f"{status} {emotion:10s}: {count:4d} files")

    print("-" * 60)
    print(f"Total organized: {total_copied} files")
    print(f"Skipped:         {skipped} files")

    if skipped > 5:
        print(f"(Only first 5 skipped files shown)")

    # Check for balance
    counts = [c for c in stats.values() if c > 0]
    if counts:
        max_count = max(counts)
        min_count = min(counts)

        if max_count > 0 and min_count > 0:
            ratio = max_count / min_count
            if ratio > 3:
                print(f"\n⚠️  Class imbalance warning:")
                print(f"   Largest class has {ratio:.1f}x more samples than smallest")
                print(f"   Consider getting more samples for underrepresented emotions")

    print(f"\n✓ Dataset organized in: {output_path}")
    print(f"\nNext step:")
    print(f"  python train_model_improved.py --data {output_path} --out model.joblib")


def main():
    parser = argparse.ArgumentParser(
        description="Organize emotion speech datasets into standard folder structure.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python prepare_dataset.py --source ./RAVDESS --output ./dataset --format ravdess
  python prepare_dataset.py --source ./CREMA-D --output ./dataset --format crema-d
  python prepare_dataset.py --source ./TESS --output ./dataset --format tess
  python prepare_dataset.py --source ./my_recordings --output ./dataset --format generic
        """
    )

    parser.add_argument(
        '--source',
        required=True,
        help='Path to the downloaded/recorded dataset'
    )

    parser.add_argument(
        '--output',
        default='./dataset',
        help='Output directory for organized dataset (default: ./dataset)'
    )

    parser.add_argument(
        '--format',
        choices=['ravdess', 'crema-d', 'tess', 'generic'],
        required=True,
        help='Dataset format type'
    )

    parser.add_argument(
        '--quiet',
        action='store_true',
        help='Suppress progress messages'
    )

    args = parser.parse_args()

    if not os.path.exists(args.source):
        print(f"❌ Error: Source directory not found: {args.source}")
        return

    organize_dataset(
        args.source,
        args.output,
        args.format,
        verbose=not args.quiet
    )


if __name__ == "__main__":
    main()
