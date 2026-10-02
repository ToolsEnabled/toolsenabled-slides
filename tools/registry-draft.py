#!/usr/bin/env python3
"""Generate external, unpublished Registry metadata from exact signed artifact bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

def generate(artifact, url, source_commit, output):
    output = output.resolve()
    if output == ROOT or ROOT in output.parents: raise ValueError('Registry metadata must remain outside the source tree')
    if not re.fullmatch('[0-9a-f]{40}', source_commit): raise ValueError('Expected a full reviewed source commit')
    location = urlsplit(url)
    if location.scheme != 'https' or location.hostname not in ('github.com', 'gitlab.com') or not location.path.endswith('.mcpb'):
        raise ValueError('Expected a GitHub or GitLab HTTPS release artifact URL')
    data = artifact.read_bytes()
    if not data.endswith(b'MCPB_SIG_END'): raise ValueError('Use the signed artifact; verify its signature separately')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    draft = {'$schema':'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
        'name':'ai.toolsenabled/slides','title':'ToolsEnabled Slides',
        'description':'Create and edit local PowerPoint decks with a live studio, slide locks and portable exports.',
        'version':version,'websiteUrl':'https://toolsenabled.ai',
        'repository':{'url':'https://github.com/ToolsEnabled/toolsenabled-slides','source':'github'},
        'packages':[{'registryType':'mcpb','identifier':url,'fileSha256':hashlib.sha256(data).hexdigest(),
                     'transport':{'type':'stdio'}}],
        '_meta':{'io.modelcontextprotocol.registry/publisher-provided':{
            'status':'unpublished-draft','sourceCommit':source_commit,'releaseUrlExists':False,
            'requiresBeforeSubmission':['Owner namespace DNS verification','Reviewed production signing and native Desktop qualification',
                'Regenerate from production-signed bytes and an existing release URL',
                'Use the exact pushed source commit in marketplace release pins']}}}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(draft, indent=2) + '\n')
    return draft

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    generate(args.artifact, args.url, args.source_commit, args.output)
