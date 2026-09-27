# Copyright 2026 Farshad Nozad Heravi
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from web_tf_editor.web_server_node import _Handler


def test_safe_join_accepts_paths_under_root():
    assert _Handler._safe_join("/srv/web", "index.html") == "/srv/web/index.html"
    assert _Handler._safe_join("/srv/web", "/dist/bundle.js") == "/srv/web/dist/bundle.js"
    assert _Handler._safe_join("/srv/web", "a/../b.js") == "/srv/web/b.js"


def test_safe_join_rejects_escapes():
    assert _Handler._safe_join("/srv/web", "../secret") is None
    assert _Handler._safe_join("/srv/web", "dist/../../secret") is None
    assert _Handler._safe_join("/srv/web", "/../../etc/passwd") is None
    # Sibling directory sharing the root"s prefix must not count as "under root".
    assert _Handler._safe_join("/srv/web", "../web2/x") is None
