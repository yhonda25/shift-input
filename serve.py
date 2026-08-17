#!/usr/bin/env python3
"""シフト入力アプリ用 HTTP サーバー（管理と入力でポートを分離）"""
import http.server
import json
import os
import re
import shutil
import socketserver
import threading
from datetime import datetime
from pathlib import Path

ADMIN_PORT = int(os.environ.get('ADMIN_PORT', '8080'))
INPUT_PORT = int(os.environ.get('INPUT_PORT', '8081'))
DIR = Path(__file__).resolve().parent
DATA_DIR = DIR / 'data'
SUBMISSIONS_DIR = DATA_DIR / 'submissions'
CONFIG_PATH = DATA_DIR / 'month-config.json'
INDEX = DIR / 'index.html'

os.chdir(DIR)
SUBMISSIONS_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    return re.sub(r'[/\\?%*:|"<>]', '_', name).strip() or 'unknown'


def submission_filename(name: str, year=None, month=None) -> str:
    safe = sanitize_filename(name)
    if year and month:
        return f'shift-request-{safe}-{int(year)}-{int(month):02d}.json'
    return f'shift-request-{safe}.json'


def submission_key(data: dict):
    name = sanitize_filename(str(data.get('name') or ''))
    month_config = data.get('monthConfig') or {}
    return name, month_config.get('year'), month_config.get('month')


def consolidate_submissions():
    """同一名・同一月は最新1件だけ残す。希望送信フォルダは削除する。"""
    groups = {}
    for folder in (SUBMISSIONS_DIR, DIR / '希望送信'):
        if not folder.exists():
            continue
        for path in folder.glob('*.json'):
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                continue
            name, year, month = submission_key(data)
            if not name:
                continue
            mtime = path.stat().st_mtime
            key = (name, year, month)
            if key not in groups or mtime >= groups[key][0]:
                groups[key] = (mtime, data)

    keep = set()
    for (name, year, month), (_, data) in groups.items():
        dest = SUBMISSIONS_DIR / submission_filename(name, year, month)
        dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        keep.add(dest.resolve())

    for path in SUBMISSIONS_DIR.glob('*.json'):
        if path.resolve() not in keep:
            path.unlink()

    leftover = DIR / '希望送信'
    if leftover.exists():
        shutil.rmtree(leftover)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class BaseHandler(http.server.SimpleHTTPRequestHandler):
    role = 'admin'
    default_page = 'admin.html'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _path_only(self):
        return self.path.split('?', 1)[0]

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return None
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_info(self):
        self._send_json(200, {
            'role': self.role,
            'adminPort': ADMIN_PORT,
            'inputPort': INPUT_PORT,
        })

    def _handle_get_month_config(self):
        if not CONFIG_PATH.exists():
            self._send_json(404, {'error': 'month-config がまだありません'})
            return
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
            self._send_json(200, {'monthConfig': data})
        except (json.JSONDecodeError, OSError) as e:
            self._send_json(500, {'error': str(e)})

    def _handle_save_month_config(self):
        try:
            data = self._read_json_body()
            month_config = data.get('monthConfig') if data else None
            if not month_config or not isinstance(month_config, dict):
                self._send_json(400, {'error': 'monthConfig が必要です'})
                return
            if not month_config.get('year') or not month_config.get('month'):
                self._send_json(400, {'error': 'year / month が必要です'})
                return
            if 'days' not in month_config or not isinstance(month_config['days'], dict):
                month_config['days'] = {}

            CONFIG_PATH.write_text(
                json.dumps(month_config, ensure_ascii=False, indent=2),
                encoding='utf-8',
            )
            updated_index = self._update_index_month_config(month_config)
            self._send_json(200, {
                'ok': True,
                'path': 'data/month-config.json',
                'indexUpdated': updated_index,
                'inputUrl': f'http://localhost:{INPUT_PORT}/',
            })
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {'error': 'JSON の形式が不正です'})
        except OSError as e:
            self._send_json(500, {'error': str(e)})

    def _update_index_month_config(self, month_config: dict) -> bool:
        if not INDEX.exists():
            return False
        html = INDEX.read_text(encoding='utf-8')
        config_json = json.dumps(month_config, ensure_ascii=False, separators=(',', ':'))
        config_json = config_json.replace('<', '\\u003c')
        new_html, n = re.subn(
            r'(<script id="month-config" type="application/json">).*?(</script>)',
            lambda m: m.group(1) + config_json + m.group(2),
            html,
            count=1,
            flags=re.DOTALL,
        )
        if n == 0:
            return False
        INDEX.write_text(new_html, encoding='utf-8')
        return True

    def _handle_submission(self):
        try:
            data = self._read_json_body()
            if not data or not data.get('name'):
                self._send_json(400, {'error': 'name が必要です'})
                return

            name = sanitize_filename(str(data['name']))
            month_config = data.get('monthConfig') or {}
            year = month_config.get('year')
            month = month_config.get('month')
            filename = submission_filename(name, year, month)
            path = SUBMISSIONS_DIR / filename
            updated = path.exists()
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

            for old in SUBMISSIONS_DIR.glob('*.json'):
                if old.resolve() == path.resolve():
                    continue
                try:
                    old_data = json.loads(old.read_text(encoding='utf-8'))
                except (json.JSONDecodeError, OSError):
                    continue
                if submission_key(old_data) == (name, year, month):
                    old.unlink()

            self._send_json(200, {
                'ok': True,
                'updated': updated,
                'filename': filename,
                'folder': 'data/submissions',
                'path': f'data/submissions/{filename}',
            })
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {'error': 'JSON の形式が不正です'})
        except OSError as e:
            self._send_json(500, {'error': str(e)})

    def _handle_list_submissions(self):
        files = []
        for path in sorted(SUBMISSIONS_DIR.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
            item = {
                'filename': path.name,
                'path': f'data/submissions/{path.name}',
                'savedAt': datetime.fromtimestamp(path.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            }
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                item['name'] = data.get('name')
                item['submittedAt'] = data.get('submittedAt')
                month_config = data.get('monthConfig') or {}
                item['year'] = month_config.get('year')
                item['month'] = month_config.get('month')
            except (json.JSONDecodeError, OSError):
                pass
            files.append(item)
        self._send_json(200, {'folder': 'data/submissions', 'files': files})

    def _rewrite_default_page(self):
        path = self._path_only()
        if path in ('/', '/index.html') and self.default_page != 'index.html':
            self.path = '/' + self.default_page


class AdminHandler(BaseHandler):
    role = 'admin'
    default_page = 'admin.html'

    def do_GET(self):
        path = self._path_only()
        if path == '/api/info':
            self._handle_info()
            return
        if path == '/api/month-config':
            self._handle_get_month_config()
            return
        if path == '/api/submissions':
            self._handle_list_submissions()
            return
        self._rewrite_default_page()
        super().do_GET()

    def do_HEAD(self):
        self._rewrite_default_page()
        super().do_HEAD()

    def do_POST(self):
        path = self._path_only()
        if path == '/api/month-config':
            self._handle_save_month_config()
            return
        self.send_error(404)


class InputHandler(BaseHandler):
    role = 'input'
    default_page = 'index.html'

    def do_GET(self):
        path = self._path_only()
        if path == '/api/info':
            self._handle_info()
            return
        if path == '/api/month-config':
            self._handle_get_month_config()
            return
        if path in ('/admin.html', '/admin', '/admin/'):
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        path = self._path_only()
        if path in ('/admin.html', '/admin', '/admin/'):
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        path = self._path_only()
        if path == '/api/submissions':
            self._handle_submission()
            return
        self.send_error(404)


def serve(port, handler_cls):
    httpd = ThreadingHTTPServer(('', port), handler_cls)
    httpd.serve_forever()


def main():
    consolidate_submissions()
    input_thread = threading.Thread(
        target=serve,
        args=(INPUT_PORT, InputHandler),
        name='input-server',
        daemon=True,
    )
    input_thread.start()

    print(f'シフト入力アプリ起動')
    print(f'  管理画面（月シフト指定）: http://localhost:{ADMIN_PORT}/')
    print(f'  入力画面（希望入力）    : http://localhost:{INPUT_PORT}/')
    print(f'  月設定: {CONFIG_PATH}')
    print(f'  希望JSON保存先: {SUBMISSIONS_DIR}')
    print('終了: Ctrl+C')
    serve(ADMIN_PORT, AdminHandler)


if __name__ == '__main__':
    main()
