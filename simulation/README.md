# Simulation Pipeline

A Python-based pipeline for generating randomized WebXR scenes with A-Frame. This tool automatically generates 3D models, processes audio, and creates HTML pages with priority-based resource loading.

## Features

- **Automated Scene Generation**: Random scene configurations with multiple 3D models
- **Priority-Based Loading**: Models in viewport get priority 1, out-of-viewport get priority 3
- **Batch Processing**: Process multiple configurations at once
- **Modular Pipeline**: Skip any step (model/audio/webpage generation) as needed

## Prerequisites

- Python 3.x
- Virtual environment (recommended)

## Setup

```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate     # On Windows

# Install dependencies
pip install trimesh numpy pydub
```

## Usage

### 1. Generate Configuration Files

```bash
python config_generator.py --num 4
```

This creates `configs/config_1.json` through `config_4.json` with random parameters:
- Clip length: 1-10 seconds
- Model count: 4-8 models per scene
- Model complexity: 500-5000 faces
- Random positions and priorities

### 2. Generate Scenes

```bash
# Generate everything (models + audio + webpages)
python main.py --configs_dir configs

# Skip audio processing (if pydub unavailable)
python main.py --configs_dir configs --skip_audio

# Skip model generation (if models already exist)
python main.py --configs_dir configs --skip_model
```

### Output Structure

```
htmls/
├── models/
│   ├── model_500.glb
│   ├── model_1000.glb
│   ├── model_2000.glb
│   └── ...
├── audios/
│   └── audio_clip.wav
├── index_1.html
├── index_2.html
└── ...
```

## Configuration Format

Each config file contains:
- **model_generation**: List of face counts to generate
- **audio_processing**: Audio clip settings
- **web_page**: Scene layout with model positions and priorities

Example priority logic:
- Priority 1: Models within camera viewport (FOV 60°)
- Priority 3: Models outside viewport

## Modules

- **config_generator.py**: Creates random scene configurations
- **model_generator.py**: Generates GLB models using trimesh
- **audio_generator.py**: Clips audio segments (requires pydub)
- **webpage_generator.py**: Creates A-Frame HTML pages
- **main.py**: Orchestrates the entire pipeline

## Notes

- Audio processing requires `pydub` and may have compatibility issues with Python 3.13+
- Generated models are simple cube assemblies for testing purposes
- Default camera position: (0, 1.6, 0) facing -Z direction

