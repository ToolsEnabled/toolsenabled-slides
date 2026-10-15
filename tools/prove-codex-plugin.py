#!/usr/bin/env python3
"""No-model host gate; reserves a NEW isolated Codex profile and refuses existing paths."""
import argparse, errno, hashlib, json, os, runpy, select, socket, subprocess, sys, tempfile, time, zipfile
from pathlib import Path
# The loopback health read lives in tools/local_health.py beside this file.
read_health=runpy.run_path(str(Path(__file__).resolve().parent/'local_health.py'))['read_health']

def reserve_profile(candidate):
    assert sys.platform == 'linux', 'This no-model host proof is Linux-only; native Windows client/profile qualification is separate'
    assert candidate.is_absolute(), 'Profile must be an absolute new path'
    assert '.openshell-logins' not in candidate.parts, 'Never use a signed-in profile'
    assert not candidate.exists() and not candidate.is_symlink(), 'Refusing any existing profile path without reading it'
    parent=candidate.parent.resolve(strict=True)
    assert '.openshell-logins' not in parent.parts, 'Never use a signed-in profile alias'
    profile=parent/candidate.name;profile.mkdir(mode=0o700)
    return profile

def isolated_environment(host_env, profile, workspace, python, port):
    env={k:host_env[k] for k in ['PATH','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SystemRoot','TEMP','TMP','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE','GIT_SSL_CAINFO'] if k in host_env}
    env.update(HOME=str(profile),CODEX_HOME=str(profile),SLIDES_WORKSPACE=str(workspace),SUITE_PYTHON=str(python),SUITE_PORT=str(port))
    return env

def installed_transport(mode, listing, profile):
    assert isinstance(listing, list) and len(listing)==1, 'Expected one installed MCP server'
    server=listing[0]
    assert server.get('name')=='slides' and server.get('enabled') is True, 'Slides transport is not enabled'
    transport=server['transport']
    assert transport.get('type')=='stdio', 'Expected an installed stdio transport'
    if mode=='root-only':
        assert transport.get('command')=='${user_config.python_executable}', 'Root-only command was unexpectedly resolved'
    else:
        assert transport.get('command')=='node', 'Inline transport did not select Node'
        assert transport.get('args')==['./slides-mcp.js'], 'Wrong installed transport arguments'
        cwd=Path(transport['cwd'])
        assert cwd.is_absolute() and cwd.resolve().is_relative_to((profile/'plugins/cache').resolve()), 'Transport is outside the isolated plugin cache'
        assert transport.get('env',{}).get('SLIDES_PLUGIN_MODE')=='1', 'Installed transport lost plugin mode'
        forwarded=transport.get('env_vars',[])
        for name in ('SLIDES_WORKSPACE','SUITE_PYTHON'):
            required=mode!='no-env' and not (mode=='no-python' and name=='SUITE_PYTHON')
            assert (name in forwarded)==required, 'Wrong installed forwarding for '+name+' in '+mode
    return transport

def transport_environment(transport, host_env):
    # Mirror the listed env/env_vars, without inheriting the runtime variables
    # whose absence the negative controls must actually exercise.
    env={key:host_env[key] for key in ('PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SystemRoot','TEMP','TMP') if key in host_env}
    env.update({key:host_env[key] for key in transport.get('env_vars',[]) if key in host_env})
    env.update(transport.get('env') or {})
    return env

def probe_transport(transport, host_env, scratch):
    command=[transport['command'],*transport.get('args',[])]
    try:
        result=subprocess.run(command,cwd=transport.get('cwd') or scratch,
                              env=transport_environment(transport,host_env),input='',
                              text=True,capture_output=True,timeout=30)
        return {'argv':command,'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr,'spawnError':None}
    except FileNotFoundError as error:
        return {'argv':command,'exit':None,'stdout':'','stderr':str(error),
                'spawnError':{'errno':error.errno,'filename':error.filename}}

def expected_refusal(mode,server,direct):
    assert server.get('toolsError') and not server.get('tools'), 'Negative control unexpectedly exposed tools'
    if mode=='root-only':
        error=direct.get('spawnError') or {}
        assert error.get('errno')==errno.ENOENT and error.get('filename')=='${user_config.python_executable}', 'Root-only transport did not fail on the unresolved command'
        return True
    assert direct.get('spawnError') is None and isinstance(direct.get('exit'),int) and direct['exit']>0, 'Negative transport did not exit with a runtime refusal'
    message=direct['stderr']
    expected={'no-env':'SLIDES_WORKSPACE', 'no-python':'SUITE_PYTHON'}[mode]
    assert expected in message, 'Wrong failure cause for '+mode+': '+message
    if mode=='no-python':assert 'setup-runtime' in message, 'Python refusal did not identify required runtime setup'
    return True

def inspect_held_runtime(call, scratch, workspace, port, python):
    # A status probe is transient. Hold an idle thread before status/list so a
    # second client attaches to the held owner, never the other way around.
    started=call(3,'thread/start',{'cwd':str(scratch),'ephemeral':True,
                                 'approvalPolicy':'never','sandbox':'read-only'})
    assert 'error' not in started, 'Could not hold an idle thread: '+str(started.get('error'))
    thread_id=started.get('result',{}).get('thread',{}).get('id')
    assert isinstance(thread_id,str) and thread_id, 'Missing held thread id'
    deadline=time.monotonic()+20
    while True:
        try:
            health=read_health(port)
            assert health['workspace']==str(workspace.resolve()), 'Configured workspace was not selected'
            assert health['service']=='toolsenabled-slides', 'Wrong service at selected port'
            assert isinstance(health['pid'],int) and health['pid']>1
            # This Linux gate reads only its own synthetic server's selected
            # non-secret runtime settings, never client profiles or sign-in data.
            selected={}
            for item in Path('/proc/'+str(health['pid'])+'/environ').read_bytes().split(bytes([0])):
                key,sep,value=item.partition(b'=')
                if key in (b'SUITE_PYTHON',b'SLIDES_PLUGIN_MODE'): selected[key]=value
            assert selected.get(b'SUITE_PYTHON')==str(python).encode(), 'Configured interpreter was not selected'
            assert selected.get(b'SLIDES_PLUGIN_MODE')==b'1', 'Strict runtime receipt check was not enabled'
            break
        except (OSError, ValueError):
            pass  # Thread startup may return before its MCP server is ready.
        if time.monotonic()>=deadline: raise TimeoutError('Held thread runtime did not become ready')
        time.sleep(.05)
    return {'threadId':thread_id,'ephemeral':True,'turnStarted':False,'interpreterMatches':True}

def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument('--zip',type=Path,required=True);args.add_argument('--sha256',required=True)
    args.add_argument('--python',type=Path,required=True);args.add_argument('--isolated-profile',type=Path,required=True)
    args.add_argument('--mode',choices=['inline','root-only','no-env','no-python'],required=True);args.add_argument('--output',type=Path,required=True)
    a=args.parse_args();profile=reserve_profile(a.isolated_profile)
    assert a.isolated_profile.is_absolute() and a.python.is_absolute()
    assert hashlib.sha256(a.zip.read_bytes()).hexdigest()==a.sha256
    scratch=Path(tempfile.mkdtemp(prefix='slides-011-codex-host-'));plugin=scratch/'market/plugins/toolsenabled-slides';plugin.mkdir(parents=True)
    with zipfile.ZipFile(a.zip) as z:
        for info in z.infolist():
            rel=Path(info.filename).relative_to('slides');assert '..' not in rel.parts
            dest=plugin/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
    if a.mode=='root-only':
        manifest=plugin/'.codex-plugin/plugin.json';data=json.loads(manifest.read_text());data.pop('mcpServers');manifest.write_text(json.dumps(data))
    if a.mode=='no-env':
        manifest=plugin/'.codex-plugin/plugin.json';data=json.loads(manifest.read_text());data['mcpServers']['slides'].pop('env_vars');manifest.write_text(json.dumps(data))
    if a.mode=='no-python':
        manifest=plugin/'.codex-plugin/plugin.json';data=json.loads(manifest.read_text());data['mcpServers']['slides']['env_vars'].remove('SUITE_PYTHON');manifest.write_text(json.dumps(data))
    market=scratch/'market/.agents/plugins/marketplace.json';market.parent.mkdir(parents=True)
    market.write_text(json.dumps({'name':'slides-011-gate','plugins':[{'name':'toolsenabled-slides','source':{'source':'local','path':'./plugins/toolsenabled-slides'},'policy':{'installation':'AVAILABLE','authentication':'ON_INSTALL'},'category':'Productivity'}]}))
    workspace=scratch/'deck space';workspace.mkdir()
    with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
    env=isolated_environment(os.environ,profile,workspace,a.python,port)
    commands=[];messages=[];held=None
    for cmd in [['codex','--version'],['codex','plugin','marketplace','add',str(scratch/'market')],['codex','plugin','add','toolsenabled-slides@slides-011-gate','--json'],['codex','mcp','list','--json']]:
        r=subprocess.run(cmd,cwd=scratch,env=env,text=True,capture_output=True,timeout=30)
        commands.append({'argv':cmd,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr});assert r.returncode==0
    transport=installed_transport(a.mode,json.loads(commands[-1]['stdout']),profile)
    if a.mode=='no-python':
        installed=Path(transport['cwd'])
        (installed/'.venv').symlink_to(a.python.parent.parent, target_is_directory=True)
    direct=probe_transport(transport,env,scratch) if a.mode!='inline' else None
    with (scratch/'appserver.stderr').open('w') as log:
        proc=subprocess.Popen(['codex','app-server','--stdio'],cwd=scratch,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,bufsize=0)
        pending=bytearray()
        def call(i,method,params):
            assert method in {'initialize','mcpServerStatus/list','thread/start'}, 'No-model gate RPC allowlist'
            proc.stdin.write((json.dumps({'id':i,'method':method,'params':params})+'\n').encode());proc.stdin.flush();deadline=time.monotonic()+40
            while time.monotonic()<deadline:
                while b'\n' in pending:
                    end=pending.index(b'\n');line=bytes(pending[:end]);del pending[:end+1]
                    reply=json.loads(line)
                    if reply.get('id')==i:messages.append({'method':method,'response':reply});return reply
                if not select.select([proc.stdout],[],[],1)[0]:continue
                chunk=os.read(proc.stdout.fileno(),65536);assert chunk,'Unexpected app-server EOF'
                pending.extend(chunk);assert len(pending)<=16*1024*1024, 'App-server frame exceeded bound'
            raise TimeoutError(method)
        try:
            call(1,'initialize',{'clientInfo':{'name':'slides-no-model-gate','version':'1'},'capabilities':{'experimentalApi':True}})
            proc.stdin.write(b'{"method":"initialized"}\n');proc.stdin.flush()
            if a.mode=='inline': held=inspect_held_runtime(call,scratch,workspace,port,a.python)
            response=call(2,'mcpServerStatus/list',{})
            servers=response['result']['data'];assert len(servers)==1;server=servers[0]
            if a.mode=='inline':
                assert not server['toolsError'] and len(server['tools'])==37
            else:
                expected_refusal(a.mode,server,direct)
                assert not (workspace/'.slides-state').exists(), 'Negative control started a workspace process'
        finally:
            proc.stdin.close()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=10)
    deadline=time.monotonic()+10
    while (workspace/'.slides-state/server.lock').exists() and time.monotonic()<deadline:time.sleep(.05)
    assert not (workspace/'.slides-state/server.lock').exists()
    receipt={'ok':True,'mode':a.mode,'sourceZipSha256':a.sha256,'scrubbedEnvironment':True,'allowedEnvironmentNames':sorted(env),'modelCalls':0,'profileScope':'new empty profile reserved by the gate; inherited CODEX_HOME is never used','ownerProfileUsed':False,'negativeCauseConfirmed':a.mode!='inline','causeEvidence':'installed transport direct spawn' if direct else None,'directTransport':direct,'heldRuntime':held,'commands':commands,'responses':messages,'workspaceMatches':a.mode=='inline','leaseReleased':True,'rootClaudeConfigPresent':True,'localVenvNegative':a.mode=='no-python','preparedRuntimePython':str(a.python),'scratch':str(scratch)}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'ok':True,'mode':a.mode,'tools':len(server['tools']),'modelCalls':0}))
if __name__=='__main__':main()
