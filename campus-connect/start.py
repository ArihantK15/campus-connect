"""Start the Flask API and Campus Connect frontend on one local origin."""
from pathlib import Path
import sys
import webbrowser

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from werkzeug.serving import make_server

from app import app

server = make_server("127.0.0.1", 0, app, threaded=True)
url = f"http://127.0.0.1:{server.server_port}"
print(f'\nCampus Connect is running at {url}\nKeep this window open. Press Control+C to stop.\n', flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    print('\nCampus Connect stopped.')
finally:
    server.server_close()
