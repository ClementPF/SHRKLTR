"""No-start checks of the production Compose wiring for public URLs.

Renders docker-compose.prod.yml with representative hostnames in an isolated directory, so a
real .env.production is never read and nothing is built or started.
"""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
APP = "app.example.com"
API = "api.example.com"


def docker_compose_available():
    if shutil.which("docker") is None:
        return False
    probe = subprocess.run(
        ["docker", "compose", "version"], capture_output=True, text=True, check=False
    )
    return probe.returncode == 0


@unittest.skipUnless(docker_compose_available(), "docker compose is not installed")
class ProductionComposeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copy(REPO / "docker-compose.prod.yml", root / "docker-compose.prod.yml")
            env = root / ".env.production"
            env.write_text(
                "\n".join(
                    [
                        f"APP_HOSTNAME={APP}",
                        f"API_HOSTNAME={API}",
                        "POSTGRES_PASSWORD=00",
                        "GOOGLE_CLIENT_ID=client.apps.googleusercontent.com",
                        "",
                    ]
                )
            )
            rendered = subprocess.run(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(root / "docker-compose.prod.yml"),
                    "--env-file",
                    str(env),
                    "config",
                    "--format",
                    "json",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        cls.services = json.loads(rendered.stdout)["services"]

    def test_api_uses_the_configured_public_origins(self):
        environment = self.services["api"]["environment"]
        self.assertEqual(environment["PUBLIC_API_URL"], f"https://{API}")
        self.assertEqual(environment["PUBLIC_WEB_URL"], f"https://{APP}")
        self.assertEqual(environment["CORS_ORIGINS"], f"https://{APP}")
        self.assertEqual(environment["GOOGLE_REDIRECT_ALLOWLIST"], f"https://{APP}")

    def test_web_build_receives_the_public_api_and_web_urls(self):
        args = self.services["web"]["build"]["args"]
        self.assertEqual(args["EXPO_PUBLIC_API_URL"], f"https://{API}")
        self.assertEqual(args["EXPO_PUBLIC_WEB_URL"], f"https://{APP}")

    def test_no_rendered_url_points_at_localhost(self):
        for name in ("api", "web"):
            rendered = json.dumps(self.services[name])
            self.assertNotIn("localhost", rendered, name)


class WebDockerfileTests(unittest.TestCase):
    def test_web_url_build_arg_is_required_and_exported(self):
        dockerfile = (REPO / "docker" / "web" / "Dockerfile").read_text()
        self.assertIn("ARG EXPO_PUBLIC_WEB_URL", dockerfile)
        self.assertIn("EXPO_PUBLIC_WEB_URL=$EXPO_PUBLIC_WEB_URL", dockerfile)
        self.assertIn('test -n "$EXPO_PUBLIC_WEB_URL"', dockerfile)


if __name__ == "__main__":
    unittest.main()
