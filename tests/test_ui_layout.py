from html.parser import HTMLParser
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class LayoutParser(HTMLParser):
    VOID_ELEMENTS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__()
        self.stack = []
        self.elements = {}
        self.records = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ancestors = [entry.get("id") for entry in self.stack if entry.get("id")]
        element_id = attrs.get("id")
        record = {"tag": tag, "attrs": attrs, "ancestors": ancestors}
        self.records.append(record)
        if element_id:
            self.elements[element_id] = record
        if tag not in self.VOID_ELEMENTS:
            self.stack.append({"tag": tag, "id": element_id})

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID_ELEMENTS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return


class PublicAndDashboardLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "campus-connect" / "index.html").read_text(encoding="utf-8")
        cls.css = (ROOT / "campus-connect" / "style.css").read_text(encoding="utf-8")
        cls.parser = LayoutParser()
        cls.parser.feed(cls.html)

    def test_public_landing_and_authenticated_shell_are_separate(self):
        landing = self.parser.elements["landing-page"]
        shell = self.parser.elements["app-shell"]
        self.assertEqual(landing["ancestors"], shell["ancestors"])
        self.assertNotIn("hidden", landing["attrs"])
        self.assertIn("hidden", shell["attrs"])
        self.assertIn("[hidden]", self.css)

    def test_dashboard_navigation_is_only_inside_authenticated_shell(self):
        sidebar_children = [
            value for value in self.parser.records
            if value["tag"] == "aside" and "sidebar" in value["attrs"].get("class", "").split()
        ]
        self.assertEqual(len(sidebar_children), 1)
        self.assertIn("app-shell", sidebar_children[0]["ancestors"])
        self.assertNotIn("landing-page", sidebar_children[0]["ancestors"])

    def test_auth_modal_and_status_ui_are_available_from_public_landing(self):
        for element_id in ("modal", "toast"):
            element = self.parser.elements[element_id]
            self.assertNotIn("app-shell", element["ancestors"])
            self.assertNotIn("landing-page", element["ancestors"])

    def test_hidden_attribute_wins_over_component_display_rules(self):
        self.assertIn("[hidden]", self.css)
        self.assertIn("display: none !important", self.css)


if __name__ == "__main__":
    unittest.main()
