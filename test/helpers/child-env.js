'use strict';
// The environment a test gives a Slides child process: the operating-system basics it needs to start
// (search path, home, temp, locale and the Windows system locations) and this suite's own SUITE_* and
// SLIDES_* settings, plus the test's overrides. Nothing else from the developer's environment, such as
// tokens, keys or agent variables, reaches the child.
const BASICS=/^(?:PATH|PATHEXT|HOME|USER|LOGNAME|USERPROFILE|TMPDIR|TEMP|TMP|LANG|LANGUAGE|LC_[A-Z]+|TZ|SYSTEMROOT|WINDIR|COMSPEC|APPDATA|LOCALAPPDATA|PROGRAMDATA|NO_COLOR|PYTHONUTF8|PYTHONDONTWRITEBYTECODE)$/i;
const SUITE=/^(?:SUITE|SLIDES)_[A-Z0-9_]+$/;
function childEnv(overrides={}){
 const env={};
 for(const [name,value] of Object.entries(process.env))if(BASICS.test(name)||SUITE.test(name))env[name]=value;
 return {...env,...overrides};
}
module.exports={childEnv};
