#!/usr/bin/env python3
"""Generate external Registry/marketplace sidecars only from an already pushed release."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import urllib.request
import zipfile
from pathlib import Path


def generate(source, repository, tag, commit, signed, release_url, output, description=None):
    if not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Expected the public HTTPS GitHub repository URL')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', tag) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Expected exact version tag and full pushed commit')
    source = source.resolve(strict=True)
    output = output.resolve()
    if output == source or source in output.parents or output.exists():
        raise ValueError('Output must be a new directory outside the product checkout')
    refs = subprocess.check_output(['git', 'ls-remote', '--exit-code', repository, 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}'], text=True)
    remote = {line.split()[1]: line.split()[0] for line in refs.splitlines()}
    peeled = remote.get('refs/tags/' + tag + '^{}', remote.get('refs/tags/' + tag))
    if peeled != commit:
        raise ValueError('Remote tag does not point at the supplied pushed commit')
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=source)
    manifest = json.loads(git('show', commit + ':.claude-plugin/plugin.json'))
    if manifest['version'] != tag[1:]:
        raise ValueError('Pushed plugin version differs from tag')
    registry_description = manifest['description'] if description is None else description
    if not isinstance(registry_description, str) or not registry_description.strip() or len(registry_description) > 100:
        raise ValueError('Registry description must contain 1 to 100 characters; supply reviewed, complete text with --description')
    payload = signed.read_bytes()
    if not payload.endswith(b'MCPB_SIG_END'):
        raise ValueError('Expected a signed mcpb; cryptographic/production trust qualification is a separate gate')
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        desktop = json.loads(z.read('manifest.json'))
        if desktop['version'] != manifest['version'] or desktop['name'] != manifest['name']:
            raise ValueError('Signed bundle identity differs from pushed source')
        if 'server.json' in z.namelist():
            raise ValueError('Registry sidecar must not be bundled')
    if not release_url.startswith(repository + '/releases/download/' + tag + '/') or not release_url.endswith('.mcpb'):
        raise ValueError('Expected exact tagged HTTPS mcpb release URL')
    with urllib.request.urlopen(release_url, timeout=30) as response:
        downloaded = response.read(64 * 1024 * 1024 + 1)
    if downloaded != payload:
        raise ValueError('Downloaded release bytes differ from supplied signed artifact')
    digest = hashlib.sha256(payload).hexdigest()
    name = manifest['name']
    if not name.startswith('toolsenabled-'):
        raise ValueError('Unexpected permanent plugin name')
    registry = {'$schema': 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
                'name': 'ai.toolsenabled/' + name.removeprefix('toolsenabled-'), 'description': registry_description,
                'version': manifest['version'], 'websiteUrl': 'https://toolsenabled.ai',
                'repository': {'url': repository, 'source': 'github'},
                'packages': [{'registryType': 'mcpb', 'identifier': release_url, 'fileSha256': digest, 'transport': {'type': 'stdio'}}]}
    entry = {'name': name, 'source': {'source': 'github', 'repo': repository.removeprefix('https://github.com/'), 'ref': tag, 'sha': commit}}
    pins = {'status': 'pushed-release', 'repository': repository, 'tag': tag, 'sourceCommit': commit,
            'sourceTree': git('rev-parse', commit + '^{tree}').decode().strip(), 'signedMcpbSha256': digest,
            'releaseUrl': release_url, 'remoteTagVerified': True, 'downloadVerified': True}
    output.mkdir(parents=True)
    for filename, value in [('server.json', registry), ('marketplace-entry.json', entry), ('SOURCE-PINS.json', pins)]:
        (output / filename).write_text(json.dumps(value, indent=2) + '\n')
    return pins

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--signed-mcpb', type=Path, required=True)
    parser.add_argument('--release-url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--description', help='Reviewed Registry description, 1 to 100 characters, used verbatim; required if the plugin description is too long')
    args = parser.parse_args()
    print(json.dumps(generate(args.source, args.repository, args.tag, args.commit, args.signed_mcpb, args.release_url, args.output, args.description), indent=2))
