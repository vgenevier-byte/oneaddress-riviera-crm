const ts = require('typescript');
const fs = require('node:fs');
for (const ext of ['.ts','.tsx']) require.extensions[ext] = function(module,filename) {module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);};
const Module=require('node:module'),path=require('node:path'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith('@/')?path.join(__dirname,'../..',request.slice(2)):request,parent,...rest);};
