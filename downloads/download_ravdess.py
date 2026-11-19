"""
Download and extract RAVDESS dataset from Zenodo.
"""
import os
import zipfile
import requests
from pathlib import Path

# RAVDESS Audio-only files (speech)
RAVDESS_URL = "https://zenodo.org/record/1188976/files/Audio_Speech_Actors_01-24.zip"

def download_file(url, dest_path):
    """Download file with progress indication."""
    print(f"Downloading from: {url}")
    print(f"Saving to: {dest_path}")

    response = requests.get(url, stream=True)
    response.raise_for_status()

    total_size = int(response.headers.get('content-length', 0))
    downloaded = 0

    with open(dest_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    percent = (downloaded / total_size) * 100
                    print(f"\rProgress: {percent:.1f}% ({downloaded / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB)", end='')

    print("\n✓ Download complete!")
    return dest_path

def extract_zip(zip_path, extract_to):
    """Extract ZIP file."""
    print(f"\nExtracting to: {extract_to}")

    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)

    print("✓ Extraction complete!")

def main():
    # Create directories
    downloads_dir = Path(".")
    extract_dir = downloads_dir / "ravdess_raw"

    downloads_dir.mkdir(exist_ok=True)
    extract_dir.mkdir(exist_ok=True)

    # Download
    zip_file = downloads_dir / "ravdess.zip"

    if not zip_file.exists():
        print("Downloading RAVDESS dataset...")
        print("This is ~1 GB and may take several minutes depending on your connection.\n")
        download_file(RAVDESS_URL, zip_file)
    else:
        print(f"✓ ZIP file already exists: {zip_file}")

    # Extract
    if not (extract_dir / "Audio_Speech_Actors_01-24").exists():
        extract_zip(zip_file, extract_dir)
    else:
        print(f"✓ Already extracted to: {extract_dir}")

    print("\n" + "="*60)
    print("✓ RAVDESS dataset ready!")
    print(f"Location: {extract_dir / 'Audio_Speech_Actors_01-24'}")
    print("="*60)

if __name__ == "__main__":
    main()
