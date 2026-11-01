import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
VOID_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class HtmlCheck(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.title_count = 0
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.title_count += 1
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID_ELEMENTS:
            return
        if not self.stack:
            self.errors.append(f"Unexpected closing tag </{tag}>")
        elif self.stack[-1] != tag:
            self.errors.append(
                f"Unmatched closing tag </{tag}>; expected </{self.stack[-1]}>"
            )
        else:
            self.stack.pop()


def check_html():
    failed = False
    for path in sorted((ROOT / "frontend").glob("*.html")):
        parser = HtmlCheck()
        try:
            parser.feed(path.read_text(encoding="utf-8"))
            parser.close()
        except (OSError, ValueError) as error:
            print(f"HTML check failed: {path.relative_to(ROOT)}: {error}", file=sys.stderr)
            failed = True
            continue

        if parser.stack:
            parser.errors.append(f"Unclosed <{parser.stack[-1]}>")
        if parser.title_count != 1:
            parser.errors.append(f"Expected one title, found {parser.title_count}")
        if parser.errors:
            print(
                f"HTML check failed: {path.relative_to(ROOT)}: "
                + "; ".join(parser.errors),
                file=sys.stderr,
            )
            failed = True
        else:
            print(f"HTML OK: {path.relative_to(ROOT)}")
    return failed


def check_markdown_links():
    failed = False
    markdown_files = [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md"))]
    link_pattern = re.compile(r"\[[^]]+\]\(([^)]+)\)")

    for path in markdown_files:
        text = path.read_text(encoding="utf-8")
        for link in link_pattern.findall(text):
            target = link.strip().split(maxsplit=1)[0].strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith("//") or not parsed.path:
                continue
            destination = (path.parent / unquote(parsed.path)).resolve()
            if not destination.exists():
                print(
                    f"Markdown link check failed: {path.relative_to(ROOT)} "
                    f"links to missing {target}.",
                    file=sys.stderr,
                )
                failed = True
        if not failed:
            print(f"Markdown links OK: {path.relative_to(ROOT)}")
    return failed


def check_vercel_config():
    config_path = ROOT / "frontend" / "vercel.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Vercel config check failed: {error}", file=sys.stderr)
        return True

    if config.get("framework") is not None or config.get("outputDirectory") != ".":
        print(
            "Vercel config check failed: expected static output from the frontend root",
            file=sys.stderr,
        )
        return True

    rewrites = config.get("rewrites")
    if not isinstance(rewrites, list):
        print("Vercel config check failed: rewrites must be a list", file=sys.stderr)
        return True

    expected_routes = {"/api/:path*", "/robots.txt", "/sitemap.xml"}
    routes = {
        rewrite.get("source")
        for rewrite in rewrites
        if isinstance(rewrite, dict)
    }
    if not expected_routes.issubset(routes):
        print("Vercel config check failed: API, robots, or sitemap rewrite is missing", file=sys.stderr)
        return True

    destinations = [
        rewrite.get("destination")
        for rewrite in rewrites
        if isinstance(rewrite, dict)
        and rewrite.get("source") in expected_routes
    ]
    if any(not isinstance(destination, str) or not destination.startswith("https://")
           for destination in destinations):
        print("Vercel config check failed: rewrite destinations must use HTTPS", file=sys.stderr)
        return True

    if any(not any(route in destination for route in expected_routes)
           for destination in destinations):
        print("Vercel config check failed: a rewrite destination is missing its route", file=sys.stderr)
        return True

    print("Vercel rewrite config OK")
    return False


def main():
    failed = check_html()
    failed = check_markdown_links() or failed
    failed = check_vercel_config() or failed
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
