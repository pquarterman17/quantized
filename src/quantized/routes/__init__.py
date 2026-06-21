"""Thin FastAPI adapters: validate → call io/calc → serialize. No business logic.

One small router per domain (parsers, plot, corrections, fitting, calc_*,
workspace, export, session, jobs, dev). Added from M1 #5 onward.
"""

from __future__ import annotations
