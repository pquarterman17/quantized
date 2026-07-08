# Writing a quantized plugin (API v1)

A **plugin** lets you add file parsers, curve-fit models, and pipeline steps to
quantized without forking it. A plugin is an ordinary Python module: either a
drop-in `.py` file or an installed package. It talks to quantized through a
small, stable, **pure** contract — plugins never touch FastAPI, the routes, or
the frontend; they hand pure functions to the engine and quantized wires them in.

> **Trust model — read this first.** A plugin is **arbitrary Python that you
> chose to install**, exactly like anything you `pip install`. quantized does
> **not** sandbox, vet, or restrict plugin code — sandboxing a Python
> interpreter is a losing game, and pretending otherwise would be dishonest.
> A plugin can do anything your user account can. **Install only plugins you
> trust**, from sources you trust. quantized's job is to load them robustly (a
> broken plugin is logged and skipped, never crashing the app), not to make
> untrusted code safe.

---

## How plugins are discovered

quantized loads plugins once at startup, from two places:

1. **Drop-in modules** — any `*.py` file in the plugins directory:

   | OS      | Plugins directory                                            |
   |---------|--------------------------------------------------------------|
   | Windows | `%LOCALAPPDATA%\quantized\plugins\`                          |
   | macOS   | `~/Library/Application Support/quantized/plugins/`          |
   | Linux   | `~/.config/quantized/plugins/`                              |

   (The exact base is `platformdirs.user_config_dir("quantized")`; override it
   for all of quantized with the `QZ_CONFIG_DIR` environment variable. Files
   whose names start with `_` are ignored.)

2. **Installed packages** exposing the `quantized.plugins` entry point:

   ```toml
   # in the plugin package's pyproject.toml
   [project.entry-points."quantized.plugins"]
   my_plugin = "my_plugin.plugin"     # a module that defines QZ_PLUGIN + contributions
   ```

Inspect what was found:

```console
$ qz plugin list
my_parser  (ACME .xyz reader v1.0)  [loaded]
    parsers: .xyz
ep_models  (Extra Models v2.1)  [loaded]
    fit models: Skewed Gaussian
broken_one  [error]
    ! import failed: No module named 'numpyy'
```

---

## The manifest (required)

Every plugin module must define a `QZ_PLUGIN` dict:

```python
QZ_PLUGIN = {
    "name": "ACME .xyz reader",   # human-facing name (any string)
    "version": "1.0.0",           # your plugin's version (any string)
    "api_version": 1,             # the contract version — must be 1
}
```

If `QZ_PLUGIN` is missing, malformed, or declares an `api_version` this build
does not speak, the plugin is **skipped with a logged warning** — it never
crashes startup, and other plugins still load.

---

## Contributions

A plugin defines any subset of three module-level lists. Each entry is a plain
`dict`. All functions are **pure**: data in, results out.

### 1. Parsers — read a file into a `DataStruct`

```python
PARSERS = [
    {
        "extensions": [".xyz"],          # one or more file extensions (dot optional)
        "read": read_xyz,                # path -> DataStruct  (or a DataStruct dict)
        # "sniff": looks_like_xyz,       # OPTIONAL: bytes -> bool content check
    },
]
```

- `read(path)` receives a `pathlib.Path` and must return a
  [`DataStruct`](../src/quantized/datastruct.py) — or a plain dict of the same
  shape (`{"time", "values", "labels", "units", "metadata"}`), which quantized
  converts for you.
- **`sniff` is optional.** Without it, the extension is claimed *unambiguously*.
  With it, the extension is *content-sniffed*: quantized hands your `sniff` the
  first 64 KB of the file and calls `read` only when it returns `True`. Use
  `sniff` when an extension is shared by several formats (like `.dat`).

**Precedence rule (important).** A plugin may claim a **novel** extension, but
it can **never shadow a built-in one**. If you try to claim, unambiguously, an
extension quantized already parses (e.g. `.jdx`, `.brml`, `.xrdml`), that
parser is rejected (logged; the rest of your plugin still loads) and the
built-in keeps winning. A plugin `sniff` for an ambiguous extension is always
appended *after* the built-in sniffers, so it can only ever act as a fallback.

### 2. Fit models — add a curve-fit model

```python
FIT_MODELS = [
    {
        "name": "Skewed Gaussian",       # unique; may not collide with a built-in
        "params": ["A", "mu", "sigma", "alpha"],
        "fn": skewed_gaussian,           # fn(x, params) -> y  (numpy arrays)
        # "guess": [1.0, 0.0, 1.0, 0.0], # OPTIONAL initial params (default: all ones)
    },
]
```

Your model appears in `/api/fitting/models` and anywhere quantized lists fit
models. `fn(x, p)` takes a numpy array `x` and a parameter array `p` and returns
`y`. Parameter bounds default to `±inf`. A model whose `name` already exists
(built-in or another plugin) is rejected (logged).

### 3. Steps — a pipeline transform

```python
STEPS = [
    {
        "name": "smooth5",               # unique step name
        "fn": smooth5,                   # fn(DataStruct, params) -> DataStruct
    },
]
```

In API v1 steps are **registered and listable** server-side; surfacing them in
the interactive pipeline palette (and replaying them in templates/batches) lands
in a later release. `fn(data, params)` receives a `DataStruct` and a params
`dict` and must return a `DataStruct`.

---

## Enabling / disabling

To park a plugin without deleting it, add its **source identifier** (the file
stem for a drop-in plugin, or the entry-point name for a package — the first
column of `qz plugin list`) to a `disabled` list in
`<config_dir>/plugins.json`:

```json
{ "disabled": ["broken_one", "experimental_reader"] }
```

A disabled plugin is **not imported at all** — safe to use for a plugin that
errors on import.

The `qz plugin enable` / `disable` subcommands do the same edit for you:

```console
$ qz plugin disable broken_one
[qz] plugin 'broken_one' disabled.
$ qz plugin list
broken_one  [disabled]
$ qz plugin enable broken_one
[qz] plugin 'broken_one' enabled.
```

`<name>` is the **source identifier** — the first column of `qz plugin list`
(a drop-in plugin's file stem, or a packaged plugin's entry-point name), not
the human-facing `QZ_PLUGIN["name"]`. Both subcommands are idempotent
(disabling an already-disabled plugin, or enabling one that isn't disabled,
is a no-op) and create `plugins.json` on first use. An unknown name is
rejected with a list of the currently discoverable source identifiers and a
non-zero exit code — nothing is written.

---

## Worked single-file example (all three contribution types)

Drop this as `<config_dir>/plugins/demo_plugin.py`:

```python
"""A one-file quantized plugin: a parser, a fit model, and a step."""
import numpy as np
from quantized.datastruct import DataStruct

QZ_PLUGIN = {"name": "Demo Plugin", "version": "0.1.0", "api_version": 1}


# ── a parser for a made-up two-column ".demo" format ──────────────────────
def read_demo(path):
    rows = [
        line.split()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    xy = np.asarray(rows, dtype=float)
    return DataStruct.create(
        xy[:, 0], xy[:, 1:], labels=["Signal"], units=["a.u."],
        metadata={"parser_name": "demo_plugin"},
    )


def looks_like_demo(head: bytes) -> bool:
    return head.startswith(b"# DEMO")


PARSERS = [{"extensions": [".demo"], "read": read_demo, "sniff": looks_like_demo}]


# ── a fit model ───────────────────────────────────────────────────────────
def gaussian(x, p):
    a, mu, sigma = p
    return a * np.exp(-((x - mu) ** 2) / (2.0 * sigma**2))


FIT_MODELS = [
    {"name": "Demo Gaussian", "params": ["A", "mu", "sigma"],
     "fn": gaussian, "guess": [1.0, 0.0, 1.0]},
]


# ── a pipeline step: normalize the data to unit maximum ───────────────────
def normalize(data, params):
    peak = float(np.nanmax(np.abs(data.values))) or 1.0
    return DataStruct.create(
        data.time, data.values / peak, labels=data.labels, units=data.units,
        metadata=dict(data.metadata),
    )


STEPS = [{"name": "normalize", "fn": normalize}]
```

Then:

```console
$ qz plugin list
demo_plugin  (Demo Plugin v0.1.0)  [loaded]
    parsers: .demo
    fit models: Demo Gaussian
    steps: normalize
```

A file `run1.demo` starting with `# DEMO` now imports via the normal
open-file path, `Demo Gaussian` is available to the fitting UI, and `normalize`
is a registered step.

---

## Robustness contract (what quantized guarantees)

- A plugin that **raises on import** is logged and skipped; startup continues.
- A plugin with a **missing/incompatible manifest** is skipped.
- A single **bad contribution** (e.g. an extension that shadows a built-in, or a
  duplicate model name) is rejected and reported in `qz plugin list`, while the
  plugin's other contributions still load.
- Loading is **idempotent** — reloading removes the previous load's
  registrations first, never double-registering.

## Not yet in v1 (planned)

- A `quantized-plugin-template` starter repo (one worked example per
  contribution type + CI pinned to a quantized version) — gap #10.
- Interactive pipeline-palette surfacing + template/batch replay of plugin
  steps.

---

## Publishing & discovering plugins

There is no plugin registry service (see the trust model above — quantized
deliberately stays out of the business of vetting third-party code). Publishing
a plugin today means shipping an ordinary installable Python package; here's
the shape that makes it discoverable.

### Naming and shipping a plugin package

1. Pick a distribution name (PyPI-style, e.g. `quantized-acme-reader`) and lay
   out a normal package — a `pyproject.toml` plus one importable module that
   defines `QZ_PLUGIN` and its contribution lists, exactly as in the [worked
   example](#worked-single-file-example-all-three-contribution-types) above.
2. Register the module under the `quantized.plugins` entry-point group so
   quantized's discovery (`importlib.metadata.entry_points(group="quantized.plugins")`)
   finds it once installed — no quantized-side registration step:

   ```toml
   # pyproject.toml
   [project]
   name = "quantized-acme-reader"
   dependencies = ["quantized"]

   [project.entry-points."quantized.plugins"]
   acme_reader = "quantized_acme_reader.plugin"   # module defining QZ_PLUGIN + PARSERS/...
   ```
3. Publish it however you publish any Python package (PyPI, a private index,
   or just `pip install git+https://...`). A user installs it into the same
   environment as `quantized` (`pip install quantized-acme-reader`, or
   `uv pip install ...`) and it shows up in `qz plugin list` on the next
   launch — no restart-and-hope, since discovery happens once at startup, and
   `qz plugin list`/`enable`/`disable` re-run discovery on demand.
4. Pin a `quantized` version range in `dependencies` and bump it deliberately
   when the plugin contract (`api_version`, currently `1`) changes — a plugin
   declaring an incompatible `api_version` is skipped with a logged warning,
   never crashes the host.

Drop-in `.py` files (the other discovery path, see above) are the right
choice for a personal or lab-internal script that never needs to be
`pip install`-ed by anyone else; package + entry point is the right choice
once you want to share it.

### The disabled-list mechanics

Every discovered plugin — file or package — is keyed by its **source
identifier** (file stem or entry-point name) in
`<config_dir>/plugins.json`'s `disabled` list (see "Enabling / disabling"
above). This is host-side, per-installation state: it travels with the
quantized config directory, not with the plugin package, so uninstalling a
package doesn't require editing `plugins.json` first (a stale disabled
entry for a package that's no longer installed is simply never matched by
discovery, and is harmless).

### Discovering plugins (index)

There is no live index yet — this section is the placeholder called out
above ("Not yet in v1", gap #10) until a `quantized-plugin-template` repo
exists to link from here. In the meantime, `qz plugin list` is the source of truth
for *what's installed*; to find *what exists*, search PyPI/GitHub for
packages exposing the `quantized.plugins` entry point (e.g.
`quantized-*` naming, or a `quantized-plugin` topic tag on GitHub, once
enough plugins exist to make that worth curating). Known plugins:

| Plugin | Contributes | Link |
|--------|--------------|------|
| _(none published yet)_ | | |

If you publish a quantized plugin, open a PR adding it to this table.
