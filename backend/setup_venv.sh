#!/bin/bash
# setup_venv.sh : create the backend virtual environment and install deps.
# Usage: cd backend && bash setup_venv.sh
set -e

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "✓ venv ready. Run: source .venv/bin/activate && uvicorn main:app --reload"
