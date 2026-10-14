'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');

// The one-time studio link goes to stderr, which the MCP host keeps in a log the host creates. Claude Code
// 2.1.296 wrote that log as mode 644 under umask 022 (2026-10-13 fresh-user check), so the README must not
// present a mode-600 log as the case to plan for; the protection is to open the link promptly.
test('README describes the startup log honestly: its mode depends on the host and umask; open the link promptly',()=>{
 const readme=fs.readFileSync(path.join(__dirname,'../../README.md'),'utf8');
 const paragraph=readme.split('\n').find(line=>line.includes('/studio` page can display the deck'));
 assert.ok(paragraph,'the studio-link paragraph is still in README');
 assert.doesNotMatch(readme,/mode-600|mode 600/);
 assert.match(paragraph,/mode .*depends on the host and (your|the) umask/);
 assert.match(paragraph,/readable by (every|any|other) local (user|account)/);
 assert.match(paragraph,/open (it|the link) promptly/);
 assert.match(paragraph,/never ask the agent to retrieve it/);
});
