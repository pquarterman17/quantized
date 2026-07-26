"""Deterministic fixture generators for the P0.3 timed-workflow baselines.

See ``docs/timed_workflow_baselines.md`` for the human protocol and
``tools/baselines/make_fixtures.py`` for the CLI entry point. Every generator
in this package is seeded (``numpy.random.default_rng``) so re-running it
reproduces byte-identical output — ``tests/test_baseline_fixtures.py``
enforces that against the committed set.
"""

from __future__ import annotations
