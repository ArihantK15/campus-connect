#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if [ -x "../venv/bin/python" ]; then
  exec ../venv/bin/python start.py
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 start.py
fi
printf '\nPython 3 is needed to run the local server.\nInstall it from https://www.python.org/downloads/macos/ and try again.\n'
read -r -p 'Press Return to close this window.'
