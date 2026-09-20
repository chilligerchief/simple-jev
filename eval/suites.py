"""Declarative suite loading. Dataset paths are relative to the suite file.

Adapters are registered explicitly, never imported from a dataset-controlled path.
Add native Noul, Score or workflow adapters here without changing HTTP execution.
"""
import json
import re
from pathlib import Path
from adapters import choice

ADAPTERS = {'choice-v1': choice}


def load_suite(path, override=None):
    path = Path(path)
    suite = json.loads(path.read_text())
    if suite.get('schema_version') != 1:
        raise ValueError('Unsupported suite schema version')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', suite['id']):
        raise ValueError('Suite ID must be a safe directory name')
    if not isinstance(suite.get('version'), str) or not suite['version']:
        raise ValueError('Suite version is required')
    adapter = ADAPTERS[suite['adapter']]
    dataset = Path(override) if override else path.parent/suite['dataset']
    source = dataset.read_bytes()
    rows = [json.loads(line) for line in source.splitlines() if line.strip()]
    adapter.validate(rows)
    return suite, adapter, source, rows
