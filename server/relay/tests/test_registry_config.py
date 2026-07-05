from __future__ import annotations

import unittest

from relay_server.config import _parse_registry


class RegistryConfigTests(unittest.TestCase):
    def test_parse_registry_without_http_proxy(self) -> None:
        config = _parse_registry({"url": "https://registry.example.com/"})
        self.assertEqual(config.url, "https://registry.example.com")
        self.assertIsNone(config.http_proxy)

    def test_parse_registry_with_http_proxy(self) -> None:
        config = _parse_registry(
            {
                "url": "https://registry.example.com",
                "httpProxy": "http://corp-proxy:8080",
            },
        )
        self.assertEqual(config.url, "https://registry.example.com")
        self.assertEqual(config.http_proxy, "http://corp-proxy:8080")

    def test_parse_registry_rejects_empty_http_proxy(self) -> None:
        with self.assertRaisesRegex(ValueError, "registry.httpProxy"):
            _parse_registry({"url": "https://registry.example.com", "httpProxy": "  "})

    def test_parse_registry_auto_register_defaults_false(self) -> None:
        config = _parse_registry({"url": "https://registry.example.com"})
        self.assertFalse(config.auto_register_on_startup)

    def test_parse_registry_auto_register_on_startup(self) -> None:
        config = _parse_registry(
            {
                "url": "https://registry.example.com",
                "autoRegisterOnStartup": True,
            },
        )
        self.assertTrue(config.auto_register_on_startup)

    def test_parse_registry_rejects_non_boolean_auto_register(self) -> None:
        with self.assertRaisesRegex(ValueError, "registry.autoRegisterOnStartup"):
            _parse_registry(
                {
                    "url": "https://registry.example.com",
                    "autoRegisterOnStartup": "yes",
                },
            )


if __name__ == "__main__":
    unittest.main()
