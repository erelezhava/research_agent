"""Local backend for the Deep Research browser prototype.

Stdlib-only. Binds to 127.0.0.1 only, launches Claude Code as an argv list
(never a shell string), and keeps every project's state under projects/<id>/
on disk so it survives server and browser restarts.
"""
