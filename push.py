#!/usr/bin/env python3
"""
push.py — build + lint + push helper
Usage: python3 push.py v4k "description of change"
"""
import subprocess, sys, os, datetime, re, glob

def run(cmd, **kw):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)
    if r.stdout.strip(): print(r.stdout.strip())
    if r.stderr.strip(): print(r.stderr.strip())
    return r

def main():
    version = sys.argv[1] if len(sys.argv) > 1 else 'vX'
    message = sys.argv[2] if len(sys.argv) > 2 else version

    # ── 1. Lint all JS files ──────────────────
    print("── Linting JS files ──")
    errors = []
    for f in sorted(glob.glob('js/*.js')):
        r = run(f'node --check {f}')
        if r.returncode != 0:
            errors.append(f)
            print(f'  ✗ {f}')
        else:
            print(f'  ✓ {f}')

    if errors:
        print(f'\n❌ Syntax errors in: {", ".join(errors)}')
        print('Fix errors before pushing.')
        sys.exit(1)

    print('✓ All JS files OK\n')

    # ── 2. Bust cache + version stamp ────────
    ts   = datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%MZ')
    bust = datetime.datetime.now(datetime.UTC).strftime('%Y%m%d%H%M%S')
    c    = open('index.html').read()
    c    = re.sub(r'v\d+\S* · \S+', f'{version} · {ts}', c)
    c    = re.sub(r'\?v=[a-zA-Z0-9]+', f'?v={bust}', c)
    open('index.html', 'w').write(c)
    print(f'✓ Version stamp: {version} · {ts}\n')

    # ── 3. Git commit + push ──────────────────
    run('git add -A')
    r = run(f'git commit -m "{version}: {message}"')
    if r.returncode != 0:
        print('Nothing to commit.')
        sys.exit(0)
    r = run('git push origin main')
    if r.returncode != 0:
        print('❌ Push failed.')
        sys.exit(1)
    print(f'\n✅ Pushed {version}')

if __name__ == '__main__':
    main()
