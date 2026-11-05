"""Serves the build like GitHub Pages: files under /xs-gym/, unknown paths get 404.html with status 404."""
import http.server, os, sys

ROOT = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 4300
BASE = '/xs-gym/'

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        rel = path[len(BASE):] if path.startswith(BASE) else '__none__'
        return os.path.join(ROOT, rel or 'index.html')
    def send_head(self):
        p = self.translate_path(self.path)
        if os.path.isdir(p): p = os.path.join(p, 'index.html')
        if not os.path.isfile(p):
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404); self.send_header('Content-Type', 'text/html'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return None
        return super().send_head()

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
